import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Starting seed...');

  // Clean existing data
  await prisma.aclEntry.deleteMany();
  await prisma.userRoleAssignment.deleteMany();
  await prisma.roleEntity.deleteMany();
  await prisma.user.deleteMany();
  await prisma.role.deleteMany();
  await prisma.entity.deleteMany();

  console.log('🧹 Cleaned existing data');

  // ============================================
  // CREATE ENTITIES
  // ============================================
  const entities = [
    { name: 'user', displayName: 'User', description: 'User management entity' },
    { name: 'project', displayName: 'Project', description: 'Project management entity' },
    { name: 'contribution', displayName: 'Contribution', description: 'Contribution entity' },
    {
      name: 'contribution-review',
      displayName: 'Review Contribution',
      description: 'Review Contribution',
    },
    { name: 'tag', displayName: 'Tag', description: 'Tag entity' },
    { name: 'audit-log', displayName: 'Audit Log', description: 'Audit log entity' },
    { name: 'role', displayName: 'Role', description: 'Role management entity' },
    { name: 'search', displayName: 'Search', description: 'Search management entity' },
    { name: 'report', displayName: 'Report', description: 'Report entity' },
  ];

  const createdEntities = await Promise.all(
    entities.map((entity) =>
      prisma.entity.create({
        data: {
          name: entity.name,
          displayName: entity.displayName,
          description: entity.description,
          isActive: true,
        },
      }),
    ),
  );

  console.log('📦 Created entities');

  // ============================================
  // CREATE ROLES
  // ============================================
  const adminRole = await prisma.role.create({
    data: {
      name: 'SYSTEM',
      displayName: 'Administrator',
      description: 'Full system access',
      isActive: true,
      systemRole: true,
      roleEntities: {
        create: createdEntities.map((entity) => ({
          entityId: entity.id,
        })),
      },
    },
  });

  console.log('👤 Created ADMIN role with all permissions');

  // ============================================
  // CREATE ADMIN USER
  // ============================================
  // Default password: SecurePassword123!
  const adminPassword = await bcrypt.hash('SecurePassword123!', 10);

  // Define which entities to grant directly to admin user via ACL
  // You can customize this list to grant specific entities only
  const adminEntityIds = createdEntities.map((entity) => entity.id);
  // Example: If you only want to grant specific entities:
  // const adminEntityIds = createdEntities
  //   .filter((e) => ['user', 'project', 'role'].includes(e.name))
  //   .map((e) => e.id);

  const adminUser = await prisma.user.create({
    data: {
      email: 'aqib@devslooptech.com',
      name: 'System User',
      password: adminPassword,
      department: 'Engineering',
      avatarUrl: null,
      isSystem: true,
      hasAccess: 1,
      approvalStatus: 'APPROVED',
      emailVerified: true,
      reviewedById: null, // Self-approved admin
      reviewedAt: new Date(),
      // Assign primary role via UserRoleAssignment (single source of truth)
      userRoleAssignments: {
        create: {
          roleId: adminRole.id,
          isPrimary: true,
          assignedBy: null, // System bootstrap — no assigner yet
        },
      },
      // Add direct ACL entries (entity permissions) to admin user
      aclEntries: {
        create: adminEntityIds.map((entityId) => ({
          entityId: entityId,
          grantedBy: null, // System bootstrap — no assigner yet
        })),
      },
    },
  });

  console.log('🔐 Admin user created with all entity permissions');

  console.log('✅ Seed completed successfully!');
  console.log(`
  Summary:
  - Entities: ${createdEntities.length} (user, project, contribution, tag, audit-log, role, search, report)
  - Roles: 1 (system Admin with all permissions)
  - Users: 1 (Admin user with all permissions)
  
  Admin User Credentials:
  - Email: aqib@devslooptech.com
  - Password: SecurePassword123!
  - Permissions: All ${createdEntities.length} entities (via role + direct ACL)
  - Status: Active, Approved, Email Verified
  `);
}

main()
  .catch((e) => {
    console.error('❌ Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
