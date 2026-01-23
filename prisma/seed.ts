import {
  PrismaClient,
  UserRole,
  ConfidentialityLevel,
  VisibilityLevel,
  ContributionStatus,
  TagCategory,
} from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Starting seed...');

  // Clean existing data
  await prisma.auditLog.deleteMany();
  await prisma.bookmark.deleteMany();
  await prisma.contributionTag.deleteMany();
  await prisma.contribution.deleteMany();
  await prisma.tag.deleteMany();
  await prisma.project.deleteMany();
  await prisma.user.deleteMany();

  console.log('🧹 Cleaned existing data');

  // ============================================
  // CREATE USERS
  // ============================================
  // Default password for all seed users: SecurePassword123!
  const defaultPassword = await bcrypt.hash('SecurePassword123!', 10);

  const adminUser = await prisma.user.create({
    data: {
      email: 'admin@devsloop.com',
      name: 'Admin User',
      password: defaultPassword,
      role: UserRole.ADMIN,
      department: 'Engineering',
      avatarUrl: 'https://api.dicebear.com/7.x/avataaars/svg?seed=admin',
    },
  });

  const teamLead = await prisma.user.create({
    data: {
      email: 'lead@devsloop.com',
      name: 'Sarah Johnson',
      password: defaultPassword,
      role: UserRole.TEAM_LEAD,
      department: 'Engineering',
      avatarUrl: 'https://api.dicebear.com/7.x/avataaars/svg?seed=sarah',
    },
  });

  const employee1 = await prisma.user.create({
    data: {
      email: 'john@devsloop.com',
      name: 'John Developer',
      password: defaultPassword,
      role: UserRole.EMPLOYEE,
      department: 'Engineering',
      avatarUrl: 'https://api.dicebear.com/7.x/avataaars/svg?seed=john',
    },
  });

  const employee2 = await prisma.user.create({
    data: {
      email: 'jane@devsloop.com',
      name: 'Jane Smith',
      password: defaultPassword,
      role: UserRole.EMPLOYEE,
      department: 'Engineering',
      avatarUrl: 'https://api.dicebear.com/7.x/avataaars/svg?seed=jane',
    },
  });

  console.log('👥 Created users');

  // ============================================
  // CREATE TAGS
  // ============================================
  const tags = await Promise.all([
    // Tech tags
    prisma.tag.create({ data: { name: 'React', category: TagCategory.TECH } }),
    prisma.tag.create({ data: { name: 'Node.js', category: TagCategory.TECH } }),
    prisma.tag.create({ data: { name: 'TypeScript', category: TagCategory.TECH } }),
    prisma.tag.create({ data: { name: 'PostgreSQL', category: TagCategory.TECH } }),
    prisma.tag.create({ data: { name: 'AWS', category: TagCategory.TECH } }),
    prisma.tag.create({ data: { name: 'Docker', category: TagCategory.TECH } }),
    prisma.tag.create({ data: { name: 'NestJS', category: TagCategory.TECH } }),
    prisma.tag.create({ data: { name: 'Next.js', category: TagCategory.TECH } }),
    // Skill tags
    prisma.tag.create({ data: { name: 'API Design', category: TagCategory.SKILL } }),
    prisma.tag.create({ data: { name: 'Database Optimization', category: TagCategory.SKILL } }),
    prisma.tag.create({ data: { name: 'System Architecture', category: TagCategory.SKILL } }),
    prisma.tag.create({ data: { name: 'Code Review', category: TagCategory.SKILL } }),
    // Domain tags
    prisma.tag.create({ data: { name: 'E-commerce', category: TagCategory.DOMAIN } }),
    prisma.tag.create({ data: { name: 'FinTech', category: TagCategory.DOMAIN } }),
    prisma.tag.create({ data: { name: 'Healthcare', category: TagCategory.DOMAIN } }),
  ]);

  const tagMap = tags.reduce(
    (acc, tag) => {
      acc[tag.name] = tag.id;
      return acc;
    },
    {} as Record<string, string>,
  );

  console.log('🏷️  Created tags');

  // ============================================
  // CREATE PROJECTS
  // ============================================
  const project1 = await prisma.project.create({
    data: {
      name: 'E-Commerce Platform Redesign',
      clientName: 'RetailMax Inc.',
      domain: 'E-commerce',
      description: 'Complete redesign and modernization of legacy e-commerce platform',
      startDate: new Date('2024-01-15'),
      endDate: new Date('2024-06-30'),
      techStack: ['React', 'Node.js', 'PostgreSQL', 'Redis', 'AWS'],
      confidentialityLevel: ConfidentialityLevel.INTERNAL,
    },
  });

  const project2 = await prisma.project.create({
    data: {
      name: 'Payment Gateway Integration',
      clientName: 'FinServe Corp',
      domain: 'FinTech',
      description: 'Integration of multiple payment gateways with fraud detection',
      startDate: new Date('2024-03-01'),
      endDate: new Date('2024-08-15'),
      techStack: ['NestJS', 'TypeScript', 'PostgreSQL', 'Stripe', 'Docker'],
      confidentialityLevel: ConfidentialityLevel.PRIVATE,
    },
  });

  const project3 = await prisma.project.create({
    data: {
      name: 'Internal Knowledge Base',
      clientName: 'DevsLoop',
      domain: 'Internal Tools',
      description: 'Building internal knowledge management system for the team',
      startDate: new Date('2024-05-01'),
      techStack: ['Next.js', 'NestJS', 'Prisma', 'PostgreSQL', 'Tailwind CSS'],
      confidentialityLevel: ConfidentialityLevel.PUBLIC,
    },
  });

  console.log('📁 Created projects');

  // ============================================
  // CREATE CONTRIBUTIONS
  // ============================================
  const contribution1 = await prisma.contribution.create({
    data: {
      userId: employee1.id,
      projectId: project1.id,
      roleInProject: 'Frontend Developer',
      task: 'Implement Product Catalog with Advanced Filtering',
      action:
        'Developed a high-performance product catalog component with real-time filtering, sorting, and pagination. Implemented virtualized list rendering for handling 10,000+ products without performance degradation.',
      toolsTechnologies: ['React', 'TypeScript', 'React Query', 'Tailwind CSS'],
      outcome: 'Reduced page load time by 60% and improved user engagement metrics by 25%',
      keyLearnings:
        'Learned advanced virtualization techniques and optimized re-render patterns in React. Understanding of how to balance UX with performance constraints.',
      visibilityLevel: VisibilityLevel.INTERNAL,
      status: ContributionStatus.APPROVED,
      submittedAt: new Date('2024-04-15'),
      reviewedAt: new Date('2024-04-18'),
      reviewerId: teamLead.id,
      reviewComments: 'Excellent work on the performance optimization. Well documented code.',
    },
  });

  const contribution2 = await prisma.contribution.create({
    data: {
      userId: employee1.id,
      projectId: project2.id,
      roleInProject: 'Backend Developer',
      task: 'Build Stripe Payment Integration Module',
      action:
        'Designed and implemented a modular payment service architecture supporting multiple payment providers. Created webhook handlers for real-time payment status updates and implemented idempotency for retry-safe transactions.',
      toolsTechnologies: ['NestJS', 'TypeScript', 'Stripe SDK', 'PostgreSQL'],
      outcome: 'Successfully processed over $2M in transactions with 99.9% success rate',
      keyLearnings:
        'Deep understanding of payment processing flows, PCI compliance requirements, and handling edge cases in financial transactions.',
      visibilityLevel: VisibilityLevel.PRIVATE,
      status: ContributionStatus.APPROVED,
      submittedAt: new Date('2024-05-20'),
      reviewedAt: new Date('2024-05-22'),
      reviewerId: teamLead.id,
      reviewComments:
        'Solid implementation with good error handling. Consider adding more integration tests.',
    },
  });

  const contribution3 = await prisma.contribution.create({
    data: {
      userId: employee2.id,
      projectId: project1.id,
      roleInProject: 'Full Stack Developer',
      task: 'Implement Shopping Cart with Persistence',
      action:
        'Built a full-featured shopping cart system with local storage persistence, server-side sync, and conflict resolution. Added support for guest checkout and cart recovery for logged-in users.',
      toolsTechnologies: ['React', 'Node.js', 'Redis', 'PostgreSQL'],
      outcome: 'Increased cart conversion rate by 15% and reduced cart abandonment by 20%',
      keyLearnings:
        'Learned strategies for handling distributed state and implementing eventual consistency patterns.',
      visibilityLevel: VisibilityLevel.PUBLIC_ELIGIBLE,
      status: ContributionStatus.PENDING,
      submittedAt: new Date('2024-06-01'),
      reviewerId: teamLead.id,
    },
  });

  const contribution4 = await prisma.contribution.create({
    data: {
      userId: teamLead.id,
      projectId: project3.id,
      roleInProject: 'Tech Lead',
      task: 'Design System Architecture and Database Schema',
      action:
        'Architected the complete system design for the knowledge management platform. Designed normalized database schema with proper indexing strategy. Set up CI/CD pipeline and established coding standards.',
      toolsTechnologies: ['NestJS', 'Prisma', 'PostgreSQL', 'GitHub Actions', 'Docker'],
      outcome:
        'Established a scalable foundation supporting 100+ concurrent users with sub-100ms response times',
      keyLearnings:
        'Refined skills in system design, capacity planning, and team onboarding processes.',
      visibilityLevel: VisibilityLevel.INTERNAL,
      status: ContributionStatus.APPROVED,
      submittedAt: new Date('2024-05-10'),
      reviewedAt: new Date('2024-05-12'),
      reviewerId: adminUser.id,
      reviewComments: 'Excellent architecture decisions. Well thought out schema design.',
    },
  });

  const contribution5 = await prisma.contribution.create({
    data: {
      userId: employee2.id,
      projectId: project3.id,
      roleInProject: 'Frontend Developer',
      task: 'Build Contribution Submission Form with Rich Text Editor',
      action:
        'Implementing a user-friendly contribution submission form with rich text editing capabilities, file attachments, and auto-save functionality.',
      toolsTechnologies: ['Next.js', 'TypeScript', 'Tiptap Editor', 'React Hook Form'],
      outcome: null,
      keyLearnings: null,
      visibilityLevel: VisibilityLevel.PRIVATE,
      status: ContributionStatus.DRAFT,
    },
  });

  console.log('📝 Created contributions');

  // ============================================
  // CREATE CONTRIBUTION TAGS
  // ============================================
  await prisma.contributionTag.createMany({
    data: [
      { contributionId: contribution1.id, tagId: tagMap['React'] },
      { contributionId: contribution1.id, tagId: tagMap['TypeScript'] },
      { contributionId: contribution1.id, tagId: tagMap['E-commerce'] },
      { contributionId: contribution2.id, tagId: tagMap['NestJS'] },
      { contributionId: contribution2.id, tagId: tagMap['TypeScript'] },
      { contributionId: contribution2.id, tagId: tagMap['FinTech'] },
      { contributionId: contribution2.id, tagId: tagMap['API Design'] },
      { contributionId: contribution3.id, tagId: tagMap['React'] },
      { contributionId: contribution3.id, tagId: tagMap['Node.js'] },
      { contributionId: contribution3.id, tagId: tagMap['E-commerce'] },
      { contributionId: contribution4.id, tagId: tagMap['NestJS'] },
      { contributionId: contribution4.id, tagId: tagMap['PostgreSQL'] },
      { contributionId: contribution4.id, tagId: tagMap['System Architecture'] },
      { contributionId: contribution5.id, tagId: tagMap['Next.js'] },
      { contributionId: contribution5.id, tagId: tagMap['TypeScript'] },
    ],
  });

  console.log('🔗 Created contribution tags');

  // ============================================
  // CREATE BOOKMARKS
  // ============================================
  await prisma.bookmark.createMany({
    data: [
      { userId: employee2.id, contributionId: contribution1.id },
      { userId: employee1.id, contributionId: contribution4.id },
      { userId: adminUser.id, contributionId: contribution1.id },
      { userId: adminUser.id, contributionId: contribution2.id },
    ],
  });

  console.log('🔖 Created bookmarks');

  // ============================================
  // CREATE AUDIT LOGS
  // ============================================
  await prisma.auditLog.createMany({
    data: [
      {
        userId: employee1.id,
        action: 'CREATE',
        entityType: 'Contribution',
        entityId: contribution1.id,
        changes: { status: 'DRAFT' },
        timestamp: new Date('2024-04-10'),
      },
      {
        userId: employee1.id,
        action: 'UPDATE',
        entityType: 'Contribution',
        entityId: contribution1.id,
        changes: { status: { from: 'DRAFT', to: 'PENDING' } },
        timestamp: new Date('2024-04-15'),
      },
      {
        userId: teamLead.id,
        action: 'APPROVE',
        entityType: 'Contribution',
        entityId: contribution1.id,
        changes: { status: { from: 'PENDING', to: 'APPROVED' } },
        timestamp: new Date('2024-04-18'),
      },
      {
        userId: adminUser.id,
        action: 'CREATE',
        entityType: 'Project',
        entityId: project3.id,
        changes: { name: 'Internal Knowledge Base' },
        timestamp: new Date('2024-05-01'),
      },
    ],
  });

  console.log('📋 Created audit logs');

  console.log('✅ Seed completed successfully!');
  console.log(`
  Summary:
  - Users: 4 (1 Admin, 1 Team Lead, 2 Employees)
  - Projects: 3
  - Contributions: 5
  - Tags: 15
  - Bookmarks: 4
  - Audit Logs: 4
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
