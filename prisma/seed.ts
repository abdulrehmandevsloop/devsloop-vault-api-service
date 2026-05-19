import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

// ─────────────────────────────────────────────────────────────────────────────
// Configuration
// ─────────────────────────────────────────────────────────────────────────────

/** All platform entities (permission scopes) */
const ENTITIES = [
  { name: 'user', displayName: 'User', description: 'User management' },
  { name: 'project', displayName: 'Project', description: 'Project management' },
  { name: 'contribution', displayName: 'Contribution', description: 'Contribution management' },
  {
    name: 'contribution-review',
    displayName: 'Review Contribution',
    description: 'Contribution review',
  },
  { name: 'tag', displayName: 'Tag', description: 'Tag management' },
  { name: 'audit-log', displayName: 'Audit Log', description: 'Audit log access' },
  { name: 'role', displayName: 'Role', description: 'Role management' },
  { name: 'report', displayName: 'Report', description: 'Report access' },
  { name: 'vault', displayName: 'Vault', description: 'Knowledge base vault access' },
  { name: 'asset', displayName: 'Asset', description: 'Asset management' },
  { name: 'manage-assets', displayName: 'Manage Assets', description: 'Manage own assets' },
  {
    name: 'leave-review',
    displayName: 'Leave Review',
    description:
      'Review leave requests (approve/reject) and appear as selectable reporting manager',
  },
  { name: 'worklog', displayName: 'Worklog', description: 'Daily worklog submission and tracking' },
  {
    name: 'worklog-team',
    displayName: 'View/Export Team Worklogs',
    description: 'View and export worklogs of team members on assigned projects',
  },
  {
    name: 'requests',
    displayName: 'Requests',
    description: 'Employee requests submission (reimbursements, loans, advance salary)',
  },
  {
    name: 'review-requests',
    displayName: 'Review Requests',
    description: 'Management review and processing of employee requests',
  },
  {
    name: 'payroll',
    displayName: 'Payroll',
    description: 'Payroll periods, calculations, and bank exports',
  },
  {
    name: 'manage-expense',
    displayName: 'Manage Expense',
    description: 'Manage company expenses in Expense Tracker',
  },
  {
    name: 'system-config',
    displayName: 'System Configuration',
    description:
      'Manage platform-wide settings: payroll defaults, lunch rates, worklog alerts, and leave policies',
  },
  {
    name: 'workflow',
    displayName: 'Workflow Management',
    description: 'Create, edit, delete, and view workflow templates',
  },
  {
    name: 'workflow-approve',
    displayName: 'Workflow Approve',
    description: 'Act on workflow steps (approve/reject/return)',
  },
] as const;

/** Entity entry: plain string (no actions) or object with actions */
type EntityEntry = string | { name: string; actions: string[] };

/** Role definitions — each maps to a subset of entity names */
const ROLES: {
  name: string;
  displayName: string;
  description: string;
  systemRole: boolean;
  entities: EntityEntry[] | null;
  defaultActions?: string[];
}[] = [
  {
    name: 'SYSTEM',
    displayName: 'System Administrator',
    description: 'Full system access — all entities',
    systemRole: true,
    entities: null, // null = all entities
    defaultActions: [
      'read',
      'read_all',
      'write',
      'manage_users',
      'manage_roadmap',
      'view',
      'create',
      'edit',
      'authorize',
      'export',
      'lock',
    ],
  },
  {
    name: 'EMPLOYEE',
    displayName: 'Employee',
    description:
      'Create and manage own contributions, vault access, worklog submission, reimbursements',
    systemRole: false,
    entities: [
      'asset',
      'contribution',
      'vault',
      'worklog',
      'requests',
      { name: 'project', actions: ['read'] },
    ],
  },
  {
    name: 'TEAM_LEAD',
    displayName: 'Team Lead',
    description: 'Review contributions, vault access, worklog tracking',
    systemRole: false,
    entities: [
      'asset',
      'contribution-review',
      'vault',
      'worklog',
      'leave-review',
      'worklog-team',
      'workflow-approve',
      { name: 'project', actions: ['read'] },
    ],
  },
  {
    name: 'ADMIN',
    displayName: 'Admin',
    description: 'Manage projects, roles, users, vault, assets, and reimbursements',
    systemRole: false,
    entities: [
      'manage-assets',
      { name: 'project', actions: ['read', 'read_all', 'write', 'manage_users', 'manage_roadmap'] },
      'role',
      'user',
      { name: 'payroll', actions: ['read', 'write', 'authorize', 'export', 'lock'] },
      {
        name: 'manage-expense',
        actions: ['view', 'create', 'edit', 'delete', 'export', 'view-reports'],
      },
      'asset',
      'vault',
      'worklog',
      'worklog-team',
      'system-config',
      { name: 'workflow', actions: ['read', 'write'] },
    ],
  },
];

/** Bootstrap system user */
const SYSTEM_USER = {
  email: 'aqib@devslooptech.com',
  name: 'System User',
  password: 'SecurePassword123!',
  departments: ['Software Engineering'],
  roleName: 'SYSTEM', // must match a ROLES[].name
};

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

type EntityMap = Map<string, string>; // name → id

type ResolvedEntity = { entityId: string; actions: string[] };

function resolveEntityAssignments(
  entityMap: EntityMap,
  entries: EntityEntry[] | null,
  defaultActions: string[] = [],
): ResolvedEntity[] {
  if (!entries) {
    // null = all entities with default actions
    return [...entityMap.entries()].map(([, id]) => ({
      entityId: id,
      actions: defaultActions,
    }));
  }
  return entries.map((entry) => {
    if (typeof entry === 'string') {
      const id = entityMap.get(entry);
      if (!id) throw new Error(`Entity "${entry}" not found — check ENTITIES config`);
      return { entityId: id, actions: [] };
    }
    const id = entityMap.get(entry.name);
    if (!id) throw new Error(`Entity "${entry.name}" not found — check ENTITIES config`);
    return { entityId: id, actions: entry.actions };
  });
}

function log(msg: string) {
  // eslint-disable-next-line no-console
  console.log(msg);
}

// ─────────────────────────────────────────────────────────────────────────────
// Seed
// ─────────────────────────────────────────────────────────────────────────────

async function main() {
  log('🌱 Starting seed...\n');

  // 1. Clean existing data (order matters — children before parents)
  await prisma.workflowStepInstance.deleteMany();
  await prisma.workflowInstance.deleteMany();
  await prisma.workflowStep.deleteMany();
  await prisma.workflowTemplate.deleteMany();
  await prisma.assetHistory.deleteMany();
  await prisma.asset.deleteMany();
  await prisma.assetType.deleteMany();
  await prisma.payrollAdjustmentAudit.deleteMany();
  await prisma.payrollLine.deleteMany();
  await prisma.payrollPeriod.deleteMany();
  await prisma.payrollProfile.deleteMany();
  await prisma.expense.deleteMany();
  await prisma.bookmark.deleteMany();
  await prisma.auditLog.deleteMany();
  await prisma.contribution.deleteMany();
  await prisma.userProject.deleteMany();
  await prisma.leaveBalance.deleteMany();
  await prisma.leaveRequest.deleteMany();
  await prisma.userRoleAssignment.deleteMany();
  await prisma.roleEntity.deleteMany();
  await prisma.project.deleteMany();
  await prisma.user.deleteMany();
  await prisma.role.deleteMany();
  await prisma.entity.deleteMany();

  log('   🧹 Cleaned existing data');

  // 2. Create entities
  const createdEntities = await Promise.all(
    ENTITIES.map((e) =>
      prisma.entity.create({
        data: {
          name: e.name,
          displayName: e.displayName,
          description: e.description,
          isActive: true,
        },
      }),
    ),
  );

  const entityMap: EntityMap = new Map(createdEntities.map((e) => [e.name, e.id]));

  log(`   📦 Created ${createdEntities.length} entities`);

  // 3. Create roles with their entity permissions
  const roleMap = new Map<string, string>(); // name → id

  for (const roleDef of ROLES) {
    const assignments = resolveEntityAssignments(
      entityMap,
      roleDef.entities ?? null,
      roleDef.defaultActions ?? [],
    );

    const role = await prisma.role.create({
      data: {
        name: roleDef.name,
        displayName: roleDef.displayName,
        description: roleDef.description,
        isActive: true,
        systemRole: roleDef.systemRole,
        roleEntities: {
          create: assignments.map((a) => ({
            entityId: a.entityId,
            actions: a.actions,
          })),
        },
      },
    });

    roleMap.set(role.name, role.id);

    const entityLabel = roleDef.entities
      ? roleDef.entities.map((e) => (typeof e === 'string' ? e : e.name)).join(', ')
      : 'all';
    log(
      `   👤 ${roleDef.displayName} (${roleDef.name}) → ${assignments.length} entities [${entityLabel}]`,
    );
  }

  // 4. Create system user
  const systemRoleId = roleMap.get(SYSTEM_USER.roleName);
  if (!systemRoleId) throw new Error(`Role "${SYSTEM_USER.roleName}" not found`);

  const hashedPassword = await bcrypt.hash(SYSTEM_USER.password, 10);

  await prisma.user.create({
    data: {
      email: SYSTEM_USER.email,
      name: SYSTEM_USER.name,
      password: hashedPassword,
      departments: SYSTEM_USER.departments,
      avatarUrl: null,
      isSystem: true,
      approvalStatus: 'APPROVED',
      emailVerified: true,
      reviewedById: null,
      reviewedAt: new Date(),
      userRoleAssignments: {
        create: { roleId: systemRoleId, isPrimary: true, assignedBy: null },
      },
    },
  });

  log(`   🔐 System user created (${SYSTEM_USER.email})`);

  // 5. Seed default workflow templates
  const DEFAULT_WORKFLOW_TEMPLATES: {
    name: string;
    requestType: 'LEAVE' | 'LOAN' | 'REIMBURSEMENT' | 'ADVANCE_SALARY';
    steps: {
      order: number;
      name: string;
      approverType: 'ROLE' | 'ENTITY' | 'SPECIFIC_USER';
      approverValue: string;
      rejectionPolicy: 'TERMINATE' | 'RETURN_TO_STEP' | 'RETURN_TO_START';
      isOptional: boolean;
      actions?: string[];
    }[];
  }[] = [
    {
      name: 'Leave Approval (Default)',
      requestType: 'LEAVE',
      steps: [
        {
          order: 1,
          name: 'Reporting Manager Review',
          approverType: 'SPECIFIC_USER',
          approverValue: 'metadata:reportingManagerId',
          rejectionPolicy: 'RETURN_TO_START',
          isOptional: false,
        },
        {
          order: 2,
          name: 'HR Final Approval',
          approverType: 'ENTITY',
          approverValue: 'user',
          rejectionPolicy: 'TERMINATE',
          isOptional: false,
        },
      ],
    },
    {
      name: 'Loan Approval (Default)',
      requestType: 'LOAN',
      steps: [
        {
          order: 1,
          name: 'HR/Finance Review',
          approverType: 'ENTITY',
          approverValue: 'review-requests',
          rejectionPolicy: 'TERMINATE',
          isOptional: false,
        },
        {
          order: 2,
          name: 'Disbursement Approval',
          approverType: 'ENTITY',
          approverValue: 'review-requests',
          rejectionPolicy: 'TERMINATE',
          isOptional: false,
          actions: ['DISBURSE', 'REJECT', 'VIEW'],
        },
      ],
    },
    {
      name: 'Reimbursement Approval (Default)',
      requestType: 'REIMBURSEMENT',
      steps: [
        {
          order: 1,
          name: 'HR Review',
          approverType: 'ENTITY',
          approverValue: 'review-requests',
          rejectionPolicy: 'TERMINATE',
          isOptional: false,
        },
        {
          order: 2,
          name: 'Finance Processing',
          approverType: 'ENTITY',
          approverValue: 'review-requests',
          rejectionPolicy: 'TERMINATE',
          isOptional: false,
        },
      ],
    },
    {
      name: 'Advance Salary Approval (Default)',
      requestType: 'ADVANCE_SALARY',
      steps: [
        {
          order: 1,
          name: 'Disbursement',
          approverType: 'ENTITY',
          approverValue: 'user',
          rejectionPolicy: 'TERMINATE',
          isOptional: false,
          actions: ['DISBURSE', 'REJECT', 'VIEW'],
        },
      ],
    },
  ];

  for (const templateDef of DEFAULT_WORKFLOW_TEMPLATES) {
    await prisma.workflowTemplate.create({
      data: {
        name: templateDef.name,
        requestType: templateDef.requestType,
        isDefault: true,
        isActive: true,
        steps: {
          create: templateDef.steps,
        },
      },
    });
    log(`   🔀 Workflow template: ${templateDef.name}`);
  }

  // 7. Create asset types (configurable in DB per spec)
  const ASSET_TYPES = ['Laptop', 'Phone', 'Monitor', 'Accessories', 'Other'] as const;
  for (const name of ASSET_TYPES) {
    await prisma.assetType.create({
      data: { name, isActive: true },
    });
  }
  log(`   📦 Created ${ASSET_TYPES.length} asset types`);

  // 8. Summary
  log(`
╔══════════════════════════════════════════════════════╗
║                  Seed Complete ✅                    ║
╠══════════════════════════════════════════════════════╣
║  Entities  │ ${String(createdEntities.length).padEnd(38)}║
║  Roles     │ ${String(roleMap.size).padEnd(38)}║
║  Users     │ 1 (system)                             ║
╠══════════════════════════════════════════════════════╣
║  Roles breakdown:                                    ║
║    SYSTEM    → all entities (system admin)            ║
║    EMPLOYEE  → contribution, search                  ║
║    TEAM_LEAD → contribution-review, vault, leave-review║
║    ADMIN     → project, role, user, search           ║
╠══════════════════════════════════════════════════════╣
║  System User:                                        ║
║    Email    │ ${SYSTEM_USER.email.padEnd(38)}║
║    Password │ ${SYSTEM_USER.password.padEnd(38)}║
╚══════════════════════════════════════════════════════╝
  `);
}

// ─────────────────────────────────────────────────────────────────────────────
// Execute
// ─────────────────────────────────────────────────────────────────────────────

main()
  .catch((e) => {
    console.error('❌ Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
