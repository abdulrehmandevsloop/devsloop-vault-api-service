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
] as const;

/** Role definitions — each maps to a subset of entity names */
const ROLES = [
  {
    name: 'SYSTEM',
    displayName: 'System Administrator',
    description: 'Full system access — all entities',
    systemRole: true,
    entities: null, // null = all entities
  },
  {
    name: 'EMPLOYEE',
    displayName: 'Employee',
    description: 'Create and manage own contributions, vault access, worklog submission',
    systemRole: false,
    entities: ['contribution', 'vault', 'worklog'],
  },
  {
    name: 'TEAM_LEAD',
    displayName: 'Team Lead',
    description: 'Review contributions, vault access, worklog tracking',
    systemRole: false,
    entities: ['contribution-review', 'vault', 'worklog', 'leave-review', 'worklog-team'],
  },
  {
    name: 'ADMIN',
    displayName: 'Admin',
    description: 'Manage projects, roles, users, vault, and assets',
    systemRole: false,
    entities: ['project', 'role', 'user', 'asset', 'vault', 'worklog', 'worklog-team'],
  },
] as const;

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

function getEntityIds(entityMap: EntityMap, names: readonly string[] | null): string[] {
  if (!names) return [...entityMap.values()]; // all
  return names.map((n) => {
    const id = entityMap.get(n);
    if (!id) throw new Error(`Entity "${n}" not found — check ENTITIES config`);
    return id;
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
  await prisma.assetHistory.deleteMany();
  await prisma.asset.deleteMany();
  await prisma.assetType.deleteMany();
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
    const entityIds = getEntityIds(entityMap, roleDef.entities ?? null);

    const role = await prisma.role.create({
      data: {
        name: roleDef.name,
        displayName: roleDef.displayName,
        description: roleDef.description,
        isActive: true,
        systemRole: roleDef.systemRole,
        roleEntities: {
          create: entityIds.map((id) => ({ entityId: id })),
        },
      },
    });

    roleMap.set(role.name, role.id);

    const entityLabel = roleDef.entities ? roleDef.entities.join(', ') : 'all';
    log(
      `   👤 ${roleDef.displayName} (${roleDef.name}) → ${entityIds.length} entities [${entityLabel}]`,
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
      hasAccess: 1,
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

  // 5. Create asset types (configurable in DB per spec)
  const ASSET_TYPES = ['Laptop', 'Phone', 'Monitor', 'Accessories', 'Other'] as const;
  for (const name of ASSET_TYPES) {
    await prisma.assetType.create({
      data: { name, isActive: true },
    });
  }
  log(`   📦 Created ${ASSET_TYPES.length} asset types`);

  // 6. Summary
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
