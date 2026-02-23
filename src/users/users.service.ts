import {
  Injectable,
  Logger,
  NotFoundException,
  Inject,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../prisma';
import { ApprovalStatus, Prisma } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { randomBytes } from 'crypto';
import {
  UserQueryDto,
  ApproveUserDto,
  RejectUserDto,
  ToggleStatusDto,
  PaginatedUsersResponseDto,
  UserResponseDto,
  CreateEmployeeDto,
  UpdateEmployeeDto,
} from './dto';
import { UserQueryService, UserValidationService } from './services';
import { USER_SELECT_FIELDS } from './interfaces';
import { UserApprovedEvent, UserRejectedEvent, UserStatusChangedEvent } from './events';
import { TokenService } from '../auth/services/token.service';
import { AclService } from '../rbac/rbac.service';
import { PgBossService } from '../queue/pg-boss.service';
import { getFrontendUrl } from '../common/utils/frontend-url';

const CONTRIBUTION_REVIEW_ENTITY = 'contribution-review';

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly userQueryService: UserQueryService,
    private readonly pgBossService: PgBossService,
    private readonly userValidationService: UserValidationService,
    private readonly aclService: AclService,
    private readonly eventEmitter: EventEmitter2,
    private readonly tokenService: TokenService,
    @Inject(CACHE_MANAGER) private cacheManager: Cache,
  ) {}

  /**
   * Get paginated list of users with filters and search
   */
  async findAll(
    query: UserQueryDto,
    isCurrentUserSystem = false,
  ): Promise<PaginatedUsersResponseDto> {
    const { page = 1, limit = 10, sortBy = 'createdAt', sortOrder = 'desc' } = query;

    // Build query clauses using query service
    const where = this.userQueryService.buildWhereClause(query);

    // Non-system users cannot see system users in the list
    if (!isCurrentUserSystem) {
      where.isSystem = false;
    }
    const orderBy = this.userQueryService.buildOrderByClause(sortBy, sortOrder);
    const pagination = this.userQueryService.calculatePagination(page, limit);

    // Base visibility filter (system user exclusion)
    const baseVisibility = isCurrentUserSystem ? {} : { isSystem: false };

    // Execute queries in parallel — filtered list + total + status counts
    const [users, total, statusCounts] = await Promise.all([
      this.prisma.user.findMany({
        where,
        ...pagination,
        orderBy,
        select: USER_SELECT_FIELDS,
      }),
      this.prisma.user.count({ where }),
      this.prisma.user.groupBy({
        by: ['approvalStatus'],
        where: baseVisibility,
        _count: true,
      }),
    ]);

    const totalPages = Math.ceil(total / limit);

    const userIds = users.map((u) => u.id);

    type UserProjectRow = { userId: string; project: { id: string; name: string } };

    const [hasReviewPermission, userProjectsRows] = await Promise.all([
      Promise.all(
        users.map((u) => this.aclService.userHasEntityAccess(u.id, CONTRIBUTION_REVIEW_ENTITY)),
      ),
      userIds.length > 0
        ? (this.prisma['userProject'].findMany({
            where: { userId: { in: userIds } },
            select: {
              userId: true,
              project: { select: { id: true, name: true } },
            },
          }) as Promise<UserProjectRow[]>)
        : Promise.resolve([] as UserProjectRow[]),
    ]);

    type ProjectItem = { id: string; name: string };
    const assignedByUser = new Map<string, ProjectItem[]>();
    for (const row of userProjectsRows) {
      const list = assignedByUser.get(row.userId) ?? [];
      list.push({ id: row.project.id, name: row.project.name });
      assignedByUser.set(row.userId, list);
    }

    const data = users.map((user, i) => ({
      ...user,
      hasReviewContributionPermission: hasReviewPermission[i],
      assignedProjects: assignedByUser.get(user.id) ?? [],
    })) as unknown as UserResponseDto[];

    // Parse status counts from groupBy result
    const countMap: Record<string, number> = {};
    for (const s of statusCounts) {
      countMap[s.approvalStatus] = typeof s._count === 'number' ? s._count : 0;
    }

    return {
      data,
      total,
      pendingTotal: countMap['PENDING'] ?? 0,
      approvedTotal: countMap['APPROVED'] ?? 0,
      rejectedTotal: countMap['REJECTED'] ?? 0,
      page,
      limit,
      totalPages,
      hasNextPage: page < totalPages,
      hasPreviousPage: page > 1,
    };
  }

  /**
   * Get pending approval requests (shorthand for admins)
   */
  async findPendingRequests(
    query: Omit<UserQueryDto, 'approvalStatus'>,
    isCurrentUserSystem = false,
  ): Promise<PaginatedUsersResponseDto> {
    return this.findAll(
      {
        ...query,
        approvalStatus: ApprovalStatus.PENDING,
      },
      isCurrentUserSystem,
    );
  }

  /**
   * Get a single user by ID (with caching)
   */
  async findOne(id: string): Promise<UserResponseDto> {
    const cacheKey = `user:${id}`;

    // Check cache first (cached user does not include permission; we add it below)
    const cached = await this.cacheManager.get<Record<string, any>>(cacheKey);
    let user: Record<string, any> | null = cached ?? null;

    if (!user) {
      const found = await this.prisma.user.findUnique({
        where: { id },
        select: USER_SELECT_FIELDS,
      });
      if (!found) {
        throw new NotFoundException(`User with ID ${id} not found`);
      }
      user = found;
      await this.cacheManager.set(cacheKey, user, 300);
    }

    const hasReviewContributionPermission = await this.aclService.userHasEntityAccess(
      id,
      CONTRIBUTION_REVIEW_ENTITY,
    );

    return {
      ...user,
      hasReviewContributionPermission,
    } as UserResponseDto;
  }

  /**
   * Approve a user and assign role
   */
  async approveUser(
    userId: string,
    adminId: string,
    dto: ApproveUserDto,
  ): Promise<UserResponseDto> {
    // Check if user exists
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { approvalStatus: true, email: true, name: true },
    });

    if (!user) {
      throw new NotFoundException(`User with ID ${userId} not found`);
    }

    // Validate user action
    this.userValidationService.validateUserAction(userId, adminId, user.approvalStatus, 'approve');

    const uniqueRoleIds = [...new Set(dto.roleIds)];

    // Verify all roles exist and are active
    const roles = await this.prisma.role.findMany({
      where: { id: { in: uniqueRoleIds }, isActive: true },
      select: { id: true, displayName: true },
    });

    if (roles.length !== uniqueRoleIds.length) {
      const foundIds = new Set(roles.map((r) => r.id));
      const missing = uniqueRoleIds.filter((id) => !foundIds.has(id));
      throw new BadRequestException(`Role(s) not found or inactive: ${missing.join(', ')}`);
    }

    // Get existing assignments to detect changes
    const existingAssignments = await this.prisma.userRoleAssignment.findMany({
      where: { userId },
      select: { roleId: true },
    });
    const existingRoleIdList: string[] = existingAssignments.map((a) => a.roleId);
    const rolesChanged =
      existingRoleIdList.length !== uniqueRoleIds.length ||
      existingRoleIdList.some((id) => !uniqueRoleIds.includes(id));

    // Update user approval + replace all role assignments in a transaction
    // First role in the array is the primary role
    const updatedUser = await this.prisma.$transaction(async (tx) => {
      // Update user approval status
      const updated = await tx.user.update({
        where: { id: userId },
        data: {
          approvalStatus: ApprovalStatus.APPROVED,
          department: dto.department,
          reviewedById: adminId,
          reviewedAt: new Date(),
          rejectionReason: null,
        },
        select: USER_SELECT_FIELDS,
      });

      // Delete all existing role assignments
      await tx.userRoleAssignment.deleteMany({
        where: { userId },
      });

      // Create new role assignments (first = primary, rest = secondary)
      await tx.userRoleAssignment.createMany({
        data: uniqueRoleIds.map((roleId, index) => ({
          userId,
          roleId,
          isPrimary: index === 0,
          assignedBy: adminId,
        })),
      });

      return updated;
    });

    // Invalidate caches
    await this.cacheManager.del(`user:${userId}`);
    await this.cacheManager.del(`acl:user:${userId}:roles`);

    // If roles changed, invalidate all user tokens to force re-authentication
    if (rolesChanged) {
      await this.tokenService.invalidateRefreshTokens(userId);
    }

    // Determine if this is a first-time approval (not a re-approval)
    const isFirstApproval =
      user.approvalStatus === ApprovalStatus.PENDING ||
      user.approvalStatus === ApprovalStatus.REJECTED;

    // Get role display names for the email
    const roleNames = uniqueRoleIds.map((id) => {
      const role = roles.find((r) => r.id === id);
      return role?.displayName || 'Unknown';
    });

    // Fetch admin name for email context
    const admin = await this.prisma.user.findUnique({
      where: { id: adminId },
      select: { name: true },
    });
    const adminName = admin?.name || 'An administrator';

    // Emit event for email and audit (async, non-blocking)
    this.eventEmitter.emit(
      'user.approved',
      new UserApprovedEvent(
        userId,
        user.email,
        user.name,
        adminId,
        adminName,
        user.approvalStatus,
        ApprovalStatus.APPROVED,
        isFirstApproval,
        roleNames,
        rolesChanged,
      ),
    );

    const hasReviewContributionPermission = await this.aclService.userHasEntityAccess(
      userId,
      CONTRIBUTION_REVIEW_ENTITY,
    );
    return { ...updatedUser, hasReviewContributionPermission } as unknown as UserResponseDto;
  }

  /**
   * Reject a user
   */
  async rejectUser(userId: string, adminId: string, dto: RejectUserDto): Promise<UserResponseDto> {
    // Check if user exists
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { approvalStatus: true, email: true, name: true },
    });

    if (!user) {
      throw new NotFoundException(`User with ID ${userId} not found`);
    }

    // Validate user action
    this.userValidationService.validateUserAction(userId, adminId, user.approvalStatus, 'reject');

    // Check if user has any role assignments that will be removed
    const existingAssignments = await this.prisma.userRoleAssignment.count({
      where: { userId },
    });
    const roleRemoved = existingAssignments > 0;

    // Update user and remove all role assignments in a transaction
    const updatedUser = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.user.update({
        where: { id: userId },
        data: {
          approvalStatus: ApprovalStatus.REJECTED,
          reviewedById: adminId,
          reviewedAt: new Date(),
          rejectionReason: dto.reason || null,
        },
        select: USER_SELECT_FIELDS,
      });

      // Remove all role assignments for rejected user
      await tx.userRoleAssignment.deleteMany({
        where: { userId },
      });

      return updated;
    });

    // Invalidate cache
    await this.cacheManager.del(`user:${userId}`);

    // If roles were removed, invalidate all user tokens
    // This ensures rejected users cannot access protected endpoints
    if (roleRemoved) {
      await this.tokenService.invalidateRefreshTokens(userId);
    }

    // Emit event for email and audit (async, non-blocking)
    this.eventEmitter.emit(
      'user.rejected',
      new UserRejectedEvent(
        userId,
        user.email,
        user.name,
        adminId,
        dto.reason || 'No reason provided',
      ),
    );

    const hasReviewContributionPermission = await this.aclService.userHasEntityAccess(
      userId,
      CONTRIBUTION_REVIEW_ENTITY,
    );
    return { ...updatedUser, hasReviewContributionPermission } as unknown as UserResponseDto;
  }

  /**
   * Get approval statistics for admin dashboard
   */
  async getApprovalStats(): Promise<{
    pending: number;
    approved: number;
    rejected: number;
    total: number;
  }> {
    const [pending, approved, rejected, total] = await Promise.all([
      this.prisma.user.count({ where: { approvalStatus: ApprovalStatus.PENDING } }),
      this.prisma.user.count({ where: { approvalStatus: ApprovalStatus.APPROVED } }),
      this.prisma.user.count({ where: { approvalStatus: ApprovalStatus.REJECTED } }),
      this.prisma.user.count(),
    ]);

    return { pending, approved, rejected, total };
  }

  /**
   * Toggle user access status
   * Professional practices:
   * - Prevents self-access revocation
   * - Invalidates tokens when revoking access
   * - Emits audit events
   * - Invalidates cache
   */
  async toggleUserStatus(
    userId: string,
    adminId: string,
    dto: ToggleStatusDto,
  ): Promise<UserResponseDto> {
    // Prevent self-deactivation
    if (userId === adminId) {
      throw new BadRequestException('You cannot change your own account status');
    }

    // Check if user exists
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, name: true, hasAccess: true },
    });

    if (!user) {
      throw new NotFoundException(`User with ID ${userId} not found`);
    }

    // Determine new status
    // If dto.active is provided, use it; otherwise toggle
    const newStatus =
      dto.active !== undefined ? (dto.active ? 1 : 0) : user.hasAccess === 1 ? 0 : 1;
    const previousStatus = user.hasAccess;

    // If status is not changing, return current user
    if (previousStatus === newStatus) {
      return this.findOne(userId);
    }

    // Update user status
    const updatedUser = await this.prisma.user.update({
      where: { id: userId },
      data: {
        hasAccess: newStatus,
      },
      select: USER_SELECT_FIELDS,
    });

    const hasReviewContributionPermission = await this.aclService.userHasEntityAccess(
      userId,
      CONTRIBUTION_REVIEW_ENTITY,
    );

    // Invalidate cache
    await this.cacheManager.del(`user:${userId}`);

    // If deactivating, invalidate all user tokens to force logout
    // This ensures immediate effect - user cannot use existing tokens
    if (newStatus === 0) {
      await this.tokenService.invalidateRefreshTokens(userId);
    }

    // Emit event for audit logging (async, non-blocking)
    this.eventEmitter.emit(
      'user.status-changed',
      new UserStatusChangedEvent(userId, user.email, user.name, previousStatus, newStatus, adminId),
    );

    return { ...updatedUser, hasReviewContributionPermission } as unknown as UserResponseDto;
  }

  async createEmployee(dto: CreateEmployeeDto, adminId: string): Promise<UserResponseDto> {
    const companyEmail = dto.companyEmail.trim().toLowerCase();
    const name = dto.name.trim();
    const department = dto.department.trim();
    const designation = dto.designation.trim();
    const personalEmail = dto.personalEmail?.trim().toLowerCase() ?? null;

    const existing = await this.prisma.user.findUnique({
      where: { email: companyEmail },
      select: { id: true },
    });
    if (existing) {
      throw new ConflictException('A user with this company email already exists');
    }

    const uniqueRoleIds = [...new Set(dto.roleIds)];

    const roles = await this.prisma.role.findMany({
      where: { id: { in: uniqueRoleIds }, isActive: true },
      select: { id: true },
    });
    if (roles.length !== uniqueRoleIds.length) {
      const foundIds = new Set(roles.map((r) => r.id));
      const missing = uniqueRoleIds.filter((id) => !foundIds.has(id));
      throw new BadRequestException(`Role(s) not found or inactive: ${missing.join(', ')}`);
    }

    const tempPassword = randomBytes(24).toString('base64url');
    const hashedPassword = await bcrypt.hash(tempPassword, 10);

    const created = await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          email: companyEmail,
          name,
          personalEmail,
          department,
          designation,
          joiningDate: dto.joiningDate,
          leaveDate: dto.leaveDate ?? null,
          baseSalaryMonthly: new Prisma.Decimal(dto.baseSalary),
          casualLeaveBalance: dto.casualLeaveBalance,
          sickLeaveBalance: dto.sickLeaveBalance,
          annualLeaveBalance: dto.annualLeaveBalance,
          password: hashedPassword,
          emailVerified: false,
          hasAccess: 1,
          approvalStatus: ApprovalStatus.APPROVED,
          reviewedById: adminId,
          reviewedAt: new Date(),
          rejectionReason: null,
        },
        select: USER_SELECT_FIELDS,
      });

      await tx.userRoleAssignment.createMany({
        data: uniqueRoleIds.map((roleId, index) => ({
          userId: user.id,
          roleId,
          isPrimary: index === 0,
          assignedBy: adminId,
        })),
      });

      return user;
    });

    await Promise.all([
      this.cacheManager.del(`user:${created.id}`),
      this.cacheManager.del(`acl:user:${created.id}:roles`),
    ]);

    // Re-fetch so role assignments created in the transaction are included
    return this.findOne(created.id);
  }

  async updateEmployee(id: string, dto: UpdateEmployeeDto): Promise<UserResponseDto> {
    const existing = await this.prisma.user.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!existing) {
      throw new NotFoundException(`User with ID ${id} not found`);
    }

    const data: Prisma.UserUpdateInput = {};

    if (dto.name !== undefined) {
      const trimmed = dto.name.trim();
      if (!trimmed) {
        throw new BadRequestException('Full name cannot be empty');
      }
      data.name = trimmed;
    }

    if (dto.personalEmail !== undefined) {
      data.personalEmail = dto.personalEmail.trim().toLowerCase();
    }

    if (dto.companyEmail !== undefined) {
      data.email = dto.companyEmail.trim().toLowerCase();
    }

    if (dto.department !== undefined) {
      const trimmed = dto.department.trim();
      data.department = trimmed ? trimmed : null;
    }

    if (dto.designation !== undefined) {
      const trimmed = dto.designation.trim();
      data.designation = trimmed ? trimmed : null;
    }

    if (dto.joiningDate !== undefined) {
      data.joiningDate = dto.joiningDate;
    }

    if (dto.leaveDate !== undefined) {
      data.leaveDate = dto.leaveDate;
    }

    if (dto.baseSalary !== undefined) {
      data.baseSalaryMonthly = new Prisma.Decimal(dto.baseSalary);
    }

    if (dto.casualLeaveBalance !== undefined) {
      data.casualLeaveBalance = dto.casualLeaveBalance;
    }

    if (dto.sickLeaveBalance !== undefined) {
      data.sickLeaveBalance = dto.sickLeaveBalance;
    }

    if (dto.annualLeaveBalance !== undefined) {
      data.annualLeaveBalance = dto.annualLeaveBalance;
    }

    if (Object.keys(data).length === 0) {
      return this.findOne(id);
    }

    const updated = await this.prisma.user.update({
      where: { id },
      data,
      select: USER_SELECT_FIELDS,
    });

    await this.cacheManager.del(`user:${id}`);

    const hasReviewContributionPermission = await this.aclService.userHasEntityAccess(
      id,
      CONTRIBUTION_REVIEW_ENTITY,
    );

    return { ...updated, hasReviewContributionPermission } as unknown as UserResponseDto;
  }

  /**
   * Send welcome email with temporary password to the user (company + personal email).
   * Allowed only once per user; sets welcomeEmailSentAt and updates password.
   */
  async sendWelcomeEmail(
    userId: string,
  ): Promise<{ message: string; queuedTo: string[]; welcomeEmailSentAt: Date }> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        name: true,
        email: true,
        personalEmail: true,
        welcomeEmailSentAt: true,
        userRoleAssignments: {
          where: { role: { isActive: true } },
          select: { role: { select: { displayName: true } } },
        },
      },
    });

    if (!user) {
      throw new NotFoundException(`User with ID ${userId} not found`);
    }

    if (user.welcomeEmailSentAt) {
      throw new BadRequestException(
        'Welcome email has already been sent for this user. It can only be sent once.',
      );
    }

    const tempPassword = randomBytes(12).toString('base64url').replace(/[+/=]/g, '');
    const hashedPassword = await bcrypt.hash(tempPassword, 10);
    const sentAt = new Date();

    await this.prisma.user.update({
      where: { id: userId },
      data: {
        password: hashedPassword,
        welcomeEmailSentAt: sentAt,
        mustChangePassword: true,
      },
    });

    const roleNames =
      user.userRoleAssignments?.map((a) => a.role.displayName).filter(Boolean) ?? [];
    const rolesHtml =
      roleNames.length > 0
        ? `<p>You have been assigned the following role(s):</p><ul>${roleNames.map((r) => `<li><strong>${r}</strong></li>`).join('')}</ul>`
        : '<p>Your administrator has set up your account.</p>';

    const loginUrl = `${getFrontendUrl()}/login`;
    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h1 style="color: #2563eb;">Welcome to DevsLoop Vault, ${user.name}!</h1>
        <p>Your account has been created. Use the details below to sign in.</p>
        ${rolesHtml}
        <div style="background-color: #f3f4f6; padding: 16px; border-radius: 8px; margin: 20px 0;">
          <p style="margin: 0 0 8px 0;"><strong>Login URL:</strong></p>
          <p style="margin: 0 0 12px 0;"><a href="${loginUrl}">${loginUrl}</a></p>
          <p style="margin: 0 0 8px 0;"><strong>Email:</strong> ${user.email}</p>
          <p style="margin: 0;"><strong>Temporary password:</strong> <code style="background: #e5e7eb; padding: 2px 6px;">${tempPassword}</code></p>
        </div>
        <p>We recommend changing your password after your first login.</p>
        <div style="margin-top: 20px;">
          <a href="${loginUrl}"
             style="background-color: #2563eb; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block;">
            Sign in to DevsLoop Vault
          </a>
        </div>
        <p style="margin-top: 30px; color: #6b7280; font-size: 12px;">
          If you did not expect this email, please contact your administrator.
        </p>
      </div>
    `;

    const subject = 'DevsLoop Vault – Welcome! Your account and password';
    const queuedTo: string[] = [];

    await this.pgBossService.sendToQueue(
      'email-welcome',
      { to: user.email, subject, html },
      { retryLimit: 3, retryDelay: 2000, retryBackoff: true },
    );
    queuedTo.push(user.email);

    if (
      user.personalEmail &&
      user.personalEmail.trim() !== '' &&
      user.personalEmail !== user.email
    ) {
      const personalEmail = user.personalEmail;
      await this.pgBossService.sendToQueue(
        'email-welcome',
        { to: personalEmail, subject, html },
        { retryLimit: 3, retryDelay: 2000, retryBackoff: true },
      );
      queuedTo.push(personalEmail);
    }

    await this.cacheManager.del(`user:${userId}`);
    this.logger.log(`Welcome email queued for user ${userId} to: ${queuedTo.join(', ')}`);
    return { message: 'Welcome email queued successfully.', queuedTo, welcomeEmailSentAt: sentAt };
  }
}
