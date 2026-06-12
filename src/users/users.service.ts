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
import { ApprovalStatus, EmployeeStatus, Prisma } from '@prisma/client';
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
  SalaryReportQueryDto,
} from './dto';
import { UserQueryService, UserValidationService } from './services';
import { USER_LIST_SELECT_FIELDS, USER_SELECT_FIELDS } from './interfaces';
import {
  UserApprovedEvent,
  UserRejectedEvent,
  UserStatusChangedEvent,
  UserTierChangedEvent,
} from './events';
import { TokenService } from '../auth/services/token.service';
import { AclService } from '../rbac/rbac.service';
import { PgBossService } from '../queue/pg-boss.service';
import { getFrontendUrl } from '../common/utils/frontend-url';
import { EmployeeIdService } from './services/employee-id.service';

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
    private readonly employeeIdService: EmployeeIdService,
    @Inject(CACHE_MANAGER) private cacheManager: Cache,
  ) {}

  async getNextEmployeeId(): Promise<string> {
    return this.employeeIdService.generateNextId(this.prisma);
  }

  /**
   * Get paginated list of users with filters and search
   */
  async findAll(
    query: UserQueryDto,
    isCurrentUserSystem = false,
  ): Promise<PaginatedUsersResponseDto> {
    const { page = 1, limit = 10, sortBy = 'createdAt', sortOrder = 'desc' } = query;

    // Build query clauses using query service. System users (e.g. the super
    // admin) are listed like any other user so they can be picked as a team lead.
    const where = this.userQueryService.buildWhereClause(query);

    const orderBy = this.userQueryService.buildOrderByClause(sortBy, sortOrder);
    const pagination = this.userQueryService.calculatePagination(page, limit);

    // Base visibility filter (system user exclusion)
    const baseVisibility = isCurrentUserSystem ? {} : { isSystem: false };

    // Execute queries in parallel — filtered list + total + status counts + access/password counts
    const approvedVisibility = { ...baseVisibility, approvalStatus: 'APPROVED' as const };
    const [
      users,
      total,
      statusCounts,
      activeCount,
      frozenCount,
      deactivatedCount,
      passwordPendingCount,
    ] = await Promise.all([
      this.prisma.user.findMany({
        where,
        ...pagination,
        orderBy,
        select: USER_LIST_SELECT_FIELDS,
      }),
      this.prisma.user.count({ where }),
      this.prisma.user.groupBy({
        by: ['approvalStatus'],
        where: baseVisibility,
        _count: true,
      }),
      this.prisma.user.count({ where: { ...approvedVisibility, employeeStatus: 'ACTIVE' } }),
      this.prisma.user.count({ where: { ...approvedVisibility, employeeStatus: 'FREEZE' } }),
      this.prisma.user.count({ where: { ...approvedVisibility, employeeStatus: 'DEACTIVATED' } }),
      this.prisma.user.count({
        where: { ...approvedVisibility, employeeStatus: 'ACTIVE', mustChangePassword: true },
      }),
    ]);

    const totalPages = Math.ceil(total / limit);

    const data = users as UserResponseDto[];

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
      activeTotal: activeCount,
      frozenTotal: frozenCount,
      deactivatedTotal: deactivatedCount,
      passwordPendingTotal: passwordPendingCount,
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
   * Get a single user by ID. For system users only the base profile is returned
   * (no warnings/contributions — they are not applicable). For regular users,
   * warnings, contributions and review-permission are fetched in parallel.
   */
  async findOne(id: string, requestingUserId?: string): Promise<UserResponseDto> {
    const cacheKey = `user:${id}`;

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

      // Fetch fields not yet in generated Prisma client
      const rawExtra = await this.prisma.$queryRaw<
        {
          accountHolderName: string | null;
          bankCode: string | null;
          swiftCode: string | null;
          province: string | null;
          lunchEnabled: boolean;
          incomeTaxAmount: string | null;
        }[]
      >`SELECT "accountHolderName", "bankCode", "swiftCode", "province", "lunchEnabled", "incomeTaxAmount" FROM users WHERE id = ${id}`;

      user = {
        ...found,
        ...(rawExtra[0] ?? {}),
        incomeTaxAmount:
          rawExtra[0]?.incomeTaxAmount != null ? Number(rawExtra[0].incomeTaxAmount) : null,
      };
      await this.cacheManager.set(cacheKey, user, 300);
    }

    // System users don't have warnings — skip those queries entirely.
    if (user.isSystem) {
      return {
        ...user,
        hasReviewContributionPermission: false,
        warnings: [],
        warningCount: 0,
      } as unknown as UserResponseDto;
    }

    const [hasReviewContributionPermission, warnings, warningCount, roleAssignments] =
      await Promise.all([
        this.aclService.userHasEntityAccess(id, CONTRIBUTION_REVIEW_ENTITY),
        this.prisma.userWarning.findMany({
          where: { userId: id },
          orderBy: { createdAt: 'desc' },
          take: 50,
          include: { createdBy: { select: { name: true } } },
        }),
        this.prisma.userWarning.count({ where: { userId: id } }),
        this.prisma.userRoleAssignment.findMany({
          where: {
            userId: id,
            role: {
              isActive: true,
            },
          },
          select: {
            role: {
              select: {
                roleEntities: {
                  where: {
                    entity: {
                      isActive: true,
                    },
                  },
                  select: {
                    entity: {
                      select: {
                        name: true,
                        displayName: true,
                      },
                    },
                  },
                },
              },
            },
          },
        }),
      ]);

    const warningsDto = warnings.map((w) => ({
      id: w.id,
      userId: w.userId,
      message: w.message,
      warningType: w.warningType,
      createdAt: w.createdAt.toISOString(),
      createdByName: w.createdBy?.name ?? undefined,
    }));

    const entityPermissions = new Map<string, { name: string; displayName: string }>();

    for (const assignment of roleAssignments) {
      assignment.role?.roleEntities.forEach((roleEntity) => {
        const entity = roleEntity.entity;
        entityPermissions.set(entity.name, {
          name: entity.name,
          displayName: entity.displayName,
        });
      });
    }

    const permissions = Array.from(entityPermissions.values());

    const fullResponse = {
      ...user,
      hasReviewContributionPermission,
      warnings: warningsDto,
      warningCount,
      permissions,
    } as UserResponseDto;

    if (requestingUserId) {
      const hasUserEntity = await this.aclService.userHasEntityAccess(requestingUserId, 'user');
      if (!hasUserEntity) {
        const {
          baseSalaryMonthly: _a,
          cnic: _b,
          dateOfBirth: _c,
          gender: _d,
          religion: _e,
          sect: _f,
          fatherName: _g,
          emergencyContactName: _h,
          emergencyContactPhone: _i,
          emergencyContactRelation: _j,
          personalEmail: _k,
          casualLeaveBalance: _l,
          sickLeaveBalance: _m,
          annualLeaveBalance: _n,
          wfhAllowancePerMonth: _o,
          allowMaternityLeave: _p,
          allowWeddingLeave: _q,
          allowUmrahHajjLeave: _r,
          allowOtherLeave: _s,
          allowExtraWfh: _t,
          reviewedAt: _u,
          rejectionReason: _v,
          reviewedBy: _w,
          welcomeEmailSentAt: _x,
          ...safeFields
        } = fullResponse as unknown as Record<string, unknown>;

        return { ...safeFields, warnings: [], warningCount: 0 } as unknown as UserResponseDto;
      }
    }

    return fullResponse;
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
          ...(dto.departments !== undefined ? { departments: dto.departments } : {}),
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

  async getHrDashboardStats(): Promise<{
    employees: {
      total: number;
      active: number;
      inactive: number;
      recentJoiners: number;
    };
    departments: Array<{ name: string; count: number }>;
    salary: {
      totalMonthly: number;
    };
    recentEmployees: Array<{
      id: string;
      name: string;
      email: string;
      departments: string[];
      designation: string | null;
      joiningDate: Date | null;
      avatarUrl: string | null;
      employeeStatus: string;
    }>;
    onboarding: {
      welcomeEmailSent: number;
      passwordNotChanged: number;
    };
  }> {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    // Only count employees (exclude system users e.g. system administrator)
    const approvedWhere = {
      approvalStatus: ApprovalStatus.APPROVED,
      isSystem: false,
    } as const;

    const [
      total,
      active,
      inactive,
      recentJoiners,
      departmentGroups,
      salaryAggregates,
      recentEmployees,
      welcomeEmailSent,
      passwordNotChanged,
    ] = await Promise.all([
      this.prisma.user.count({ where: approvedWhere }),
      this.prisma.user.count({ where: { ...approvedWhere, employeeStatus: 'ACTIVE' } }),
      this.prisma.user.count({ where: { ...approvedWhere, employeeStatus: { not: 'ACTIVE' } } }),
      this.prisma.user.count({
        where: { ...approvedWhere, joiningDate: { gte: thirtyDaysAgo } },
      }),
      this.prisma.$queryRaw<Array<{ dept: string; count: bigint }>>`
        SELECT dept, COUNT(DISTINCT id) as count
        FROM users, unnest(departments) AS dept
        WHERE "approvalStatus" = 'APPROVED'
        GROUP BY dept
        ORDER BY count DESC
        LIMIT 10
      `,
      this.prisma.user.aggregate({
        where: { ...approvedWhere, baseSalaryMonthly: { not: null } },
        _sum: { baseSalaryMonthly: true },
      }),
      this.prisma.user.findMany({
        where: approvedWhere,
        orderBy: { createdAt: 'desc' },
        take: 5,
        select: {
          id: true,
          name: true,
          email: true,
          departments: true,
          designation: true,
          joiningDate: true,
          avatarUrl: true,
          employeeStatus: true,
        },
      }),
      this.prisma.user.count({
        where: { ...approvedWhere, welcomeEmailSentAt: { not: null } },
      }),
      this.prisma.user.count({
        where: { ...approvedWhere, mustChangePassword: true },
      }),
    ]);

    return {
      employees: { total, active, inactive, recentJoiners },
      departments: departmentGroups.map((g) => ({
        name: g.dept,
        count: Number(g.count),
      })),
      salary: {
        totalMonthly: Number(salaryAggregates._sum.baseSalaryMonthly ?? 0),
      },
      recentEmployees,
      onboarding: { welcomeEmailSent, passwordNotChanged },
    };
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
      select: { id: true, email: true, name: true, employeeStatus: true },
    });

    if (!user) {
      throw new NotFoundException(`User with ID ${userId} not found`);
    }

    const previousStatus = user.employeeStatus;
    const newStatus = dto.employeeStatus;

    // If status is not changing, return current user
    if (previousStatus === newStatus) {
      return this.findOne(userId);
    }

    // Update user status
    const updatedUser = await this.prisma.user.update({
      where: { id: userId },
      data: {
        employeeStatus: newStatus,
      },
      select: USER_SELECT_FIELDS,
    });

    const hasReviewContributionPermission = await this.aclService.userHasEntityAccess(
      userId,
      CONTRIBUTION_REVIEW_ENTITY,
    );

    // Invalidate cache
    await this.cacheManager.del(`user:${userId}`);

    // If revoking access, invalidate all user tokens to force logout
    if (newStatus !== 'ACTIVE') {
      await this.tokenService.invalidateRefreshTokens(userId);
    }

    // Emit event for audit logging (async, non-blocking)
    this.eventEmitter.emit(
      'user.status-changed',
      new UserStatusChangedEvent(userId, user.email, user.name, previousStatus, newStatus, adminId),
    );

    return { ...updatedUser, hasReviewContributionPermission } as unknown as UserResponseDto;
  }

  /**
   * Generate a 12-character temporary password that satisfies the change-password
   * validation regex: uppercase + lowercase + digit + special char (@$!%*?&).
   * Uses crypto-random bytes throughout.
   */
  private generateTempPassword(): string {
    const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
    const lower = 'abcdefghjkmnpqrstuvwxyz';
    const digits = '23456789';
    const special = '@$!%*?&';
    const all = upper + lower + digits + special;

    // Fill 12 chars from the combined set
    const buf = randomBytes(12);
    const chars = Array.from(buf, (b) => all[b % all.length]);

    // Guarantee at least one of each required type in the first 4 positions
    const req = randomBytes(4);
    chars[0] = upper[req[0] % upper.length];
    chars[1] = lower[req[1] % lower.length];
    chars[2] = digits[req[2] % digits.length];
    chars[3] = special[req[3] % special.length];

    // Fisher-Yates shuffle with crypto bytes to avoid predictable positions
    const shuffleBuf = randomBytes(chars.length);
    for (let i = chars.length - 1; i > 0; i--) {
      const j = shuffleBuf[i] % (i + 1);
      [chars[i], chars[j]] = [chars[j], chars[i]];
    }

    return chars.join('');
  }

  async createEmployee(dto: CreateEmployeeDto, adminId: string): Promise<UserResponseDto> {
    const companyEmail = dto.companyEmail.trim().toLowerCase();
    const name = dto.name.trim();
    const departments = dto.departments;
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

    const tempPassword = this.generateTempPassword();
    const hashedPassword = await bcrypt.hash(tempPassword, 10);

    const created = await this.prisma.$transaction(async (tx) => {
      const effectiveEmployeeId = await this.employeeIdService.resolveEmployeeId(
        dto.employeeId,
        tx,
      );
      await this.employeeIdService.assertEmployeeIdUnique(effectiveEmployeeId, tx);

      const user = await tx.user.create({
        data: {
          email: companyEmail,
          name,
          personalEmail,
          departments,
          designation,
          joiningDate: dto.joiningDate,
          leaveDate: dto.leaveDate ?? null,
          baseSalaryMonthly: new Prisma.Decimal(Math.round(dto.baseSalary * 100) / 100),
          casualLeaveBalance: dto.casualLeaveBalance,
          sickLeaveBalance: dto.sickLeaveBalance,
          annualLeaveBalance: dto.annualLeaveBalance,
          wfhAllowancePerMonth: dto.wfhAllowancePerMonth,
          // Personal Information
          dateOfBirth: dto.dateOfBirth ?? null,
          cnic: dto.cnic?.trim() ?? null,
          gender: dto.gender ?? null,
          religion: dto.religion?.trim() ?? null,
          sect: dto.sect?.trim() ?? null,
          fatherName: dto.fatherName?.trim() ?? null,
          maritalStatus: dto.maritalStatus?.trim() ?? null,
          mobileNumber: dto.mobileNumber?.trim() ?? null,
          currentAddress: dto.currentAddress?.trim() ?? null,
          permanentAddress: dto.permanentAddress?.trim() ?? null,
          cityOfResidence: dto.cityOfResidence?.trim() ?? null,
          bankName: dto.bankName?.trim() ?? null,
          iban: dto.iban?.trim() ?? null,
          educationLevel: dto.educationLevel?.trim() ?? null,
          highestQualification: dto.highestQualification?.trim() ?? null,
          institutionName: dto.institutionName?.trim() ?? null,
          fieldOfStudy: dto.fieldOfStudy?.trim() ?? null,
          employeeReference: dto.employeeReference?.trim() ?? null,
          areaOfExpertise: dto.areaOfExpertise?.trim() ?? null,
          emergencyContactName: dto.emergencyContactName?.trim() ?? null,
          emergencyContactPhone: dto.emergencyContactPhone?.trim() ?? null,
          emergencyContactRelation: dto.emergencyContactRelation?.trim() ?? null,
          // Employment Information
          employeeId: effectiveEmployeeId,
          employeeType: dto.employeeType ?? null,
          employeeStatus: dto.employeeStatus ?? 'ACTIVE',
          probationPeriod: dto.probationPeriod ?? null,
          workingModel: dto.workingModel?.trim() ?? null,
          workingMode: dto.workingMode ?? null,
          workingShift: dto.workingShift?.trim() ?? null,
          workingDays: dto.workingDays?.trim() ?? null,
          ...(dto.teamLeadId ? { teamLeadId: dto.teamLeadId } : {}),
          password: hashedPassword,
          emailVerified: true,
          approvalStatus: ApprovalStatus.APPROVED,
          reviewedById: adminId,
          reviewedAt: new Date(),
          rejectionReason: null,
        },
        select: USER_SELECT_FIELDS,
      });

      // Fields not in generated Prisma client yet — set via raw SQL
      const accountHolderName = dto.accountHolderName?.trim() ?? null;
      const bankCode = dto.bankCode?.trim() ?? null;
      const swift = dto.swiftCode?.trim() ?? null;
      const province = dto.province?.trim() ?? null;
      const lunchEnabled = dto.lunchEnabled ?? true;
      const incomeTaxAmount = dto.incomeTaxAmount ?? null;
      await tx.$executeRaw`
        UPDATE users
        SET "accountHolderName" = ${accountHolderName},
            "bankCode" = ${bankCode},
            "swiftCode" = ${swift},
            "province" = ${province},
            "lunchEnabled" = ${lunchEnabled},
            "incomeTaxAmount" = ${incomeTaxAmount}
        WHERE id = ${user.id}
      `;

      await tx.userRoleAssignment.createMany({
        data: uniqueRoleIds.map((roleId, index) => ({
          userId: user.id,
          roleId,
          isPrimary: index === 0,
          assignedBy: adminId,
        })),
      });

      const year = dto.joiningDate.getFullYear();

      await tx.leaveBalance.upsert({
        where: { userId_year: { userId: user.id, year } },
        create: {
          userId: user.id,
          year,
          casualBalance: dto.casualLeaveBalance,
          sickBalance: dto.sickLeaveBalance,
          casualUsed: 0,
          sickUsed: 0,
        },
        update: {
          casualBalance: dto.casualLeaveBalance,
          sickBalance: dto.sickLeaveBalance,
        },
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

  async updateEmployee(
    id: string,
    dto: UpdateEmployeeDto,
    adminId?: string,
  ): Promise<UserResponseDto> {
    const existing = await this.prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        isSystem: true,
        joiningDate: true,
        casualLeaveBalance: true,
        sickLeaveBalance: true,
        tier: true,
      },
    });
    if (!existing) {
      throw new NotFoundException(`User with ID ${id} not found`);
    }

    // System users (e.g. the super admin) are not editable employees. The only
    // thing that may be changed here is their department assignment — every
    // other field (name, salary, leave, employment info, …) is rejected.
    if (existing.isSystem) {
      const disallowed = Object.keys(dto).filter(
        (key) => key !== 'departments' && (dto as Record<string, unknown>)[key] !== undefined,
      );
      if (disallowed.length > 0) {
        throw new BadRequestException(
          `System users can only have their departments updated. Not allowed: ${disallowed.join(', ')}`,
        );
      }
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

    if (dto.departments !== undefined) {
      data.departments = dto.departments;
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
      data.baseSalaryMonthly = new Prisma.Decimal(Math.round(dto.baseSalary * 100) / 100);
    }

    // incomeTaxAmount applied via $executeRaw inside transaction

    if (dto.casualLeaveBalance !== undefined) {
      data.casualLeaveBalance = dto.casualLeaveBalance;
    }

    if (dto.sickLeaveBalance !== undefined) {
      data.sickLeaveBalance = dto.sickLeaveBalance;
    }

    if (dto.annualLeaveBalance !== undefined) {
      data.annualLeaveBalance = dto.annualLeaveBalance;
    }

    if (dto.wfhAllowancePerMonth !== undefined) {
      data.wfhAllowancePerMonth = dto.wfhAllowancePerMonth;
    }

    // Personal Information
    if (dto.dateOfBirth !== undefined) data.dateOfBirth = dto.dateOfBirth;
    if (dto.cnic !== undefined) data.cnic = dto.cnic.trim() || null;
    if (dto.gender !== undefined) data.gender = dto.gender;
    if (dto.religion !== undefined) data.religion = dto.religion.trim() || null;
    if (dto.sect !== undefined) data.sect = dto.sect.trim() || null;
    if (dto.fatherName !== undefined) data.fatherName = dto.fatherName.trim() || null;
    if (dto.maritalStatus !== undefined) data.maritalStatus = dto.maritalStatus.trim() || null;
    if (dto.mobileNumber !== undefined) data.mobileNumber = dto.mobileNumber.trim() || null;
    if (dto.currentAddress !== undefined) data.currentAddress = dto.currentAddress.trim() || null;
    if (dto.permanentAddress !== undefined)
      data.permanentAddress = dto.permanentAddress.trim() || null;
    if (dto.cityOfResidence !== undefined)
      data.cityOfResidence = dto.cityOfResidence.trim() || null;
    if (dto.bankName !== undefined) data.bankName = dto.bankName.trim() || null;
    if (dto.iban !== undefined) data.iban = dto.iban.trim() || null;
    // accountHolderName, bankCode, swiftCode, province, lunchEnabled are not in generated
    // Prisma client yet — applied via $executeRaw inside the transaction below
    if (dto.educationLevel !== undefined) data.educationLevel = dto.educationLevel.trim() || null;
    if (dto.highestQualification !== undefined)
      data.highestQualification = dto.highestQualification.trim() || null;
    if (dto.institutionName !== undefined)
      data.institutionName = dto.institutionName.trim() || null;
    if (dto.fieldOfStudy !== undefined) data.fieldOfStudy = dto.fieldOfStudy.trim() || null;
    if (dto.employeeReference !== undefined)
      data.employeeReference = dto.employeeReference.trim() || null;
    if (dto.areaOfExpertise !== undefined)
      data.areaOfExpertise = dto.areaOfExpertise.trim() || null;
    if (dto.emergencyContactName !== undefined)
      data.emergencyContactName = dto.emergencyContactName.trim() || null;
    if (dto.emergencyContactPhone !== undefined)
      data.emergencyContactPhone = dto.emergencyContactPhone.trim() || null;
    if (dto.emergencyContactRelation !== undefined)
      data.emergencyContactRelation = dto.emergencyContactRelation.trim() || null;

    // Employment Information
    if (dto.employeeId !== undefined) {
      const normalized = this.employeeIdService.normalizeProvidedId(dto.employeeId);
      if (normalized === null) {
        data.employeeId = null;
      } else {
        data.employeeId = normalized;
      }
    }
    if (dto.employeeType !== undefined) data.employeeType = dto.employeeType;
    if (dto.employeeStatus !== undefined) data.employeeStatus = dto.employeeStatus;
    if (dto.probationPeriod !== undefined) data.probationPeriod = dto.probationPeriod;
    if (dto.workingModel !== undefined) data.workingModel = dto.workingModel.trim() || null;
    if (dto.workingMode !== undefined) data.workingMode = dto.workingMode;
    if (dto.workingShift !== undefined) data.workingShift = dto.workingShift.trim() || null;
    if (dto.workingDays !== undefined) data.workingDays = dto.workingDays.trim() || null;
    if (dto.tier !== undefined) data.tier = dto.tier;
    if (dto.teamLeadId !== undefined) {
      data.teamLeadUser = dto.teamLeadId
        ? { connect: { id: dto.teamLeadId } }
        : { disconnect: true };
    }

    const hasRawFields =
      dto.accountHolderName !== undefined ||
      dto.bankCode !== undefined ||
      dto.swiftCode !== undefined ||
      dto.province !== undefined ||
      dto.lunchEnabled !== undefined ||
      dto.incomeTaxAmount !== undefined;

    if (Object.keys(data).length === 0 && !hasRawFields) {
      return this.findOne(id);
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      if (dto.employeeId !== undefined) {
        const normalized = this.employeeIdService.normalizeProvidedId(dto.employeeId);
        if (normalized !== null) {
          await this.employeeIdService.assertEmployeeIdUnique(normalized, tx, id);
        }
      }

      let user: Record<string, unknown>;
      if (Object.keys(data).length > 0) {
        user = (await tx.user.update({
          where: { id },
          data,
          select: USER_SELECT_FIELDS,
        })) as Record<string, unknown>;
      } else {
        const found = await tx.user.findUnique({ where: { id }, select: USER_SELECT_FIELDS });
        if (!found) throw new NotFoundException(`User with ID ${id} not found`);
        user = found as Record<string, unknown>;
      }

      // Apply fields not yet in generated Prisma client via raw SQL
      const rawFields: string[] = [];
      const rawValues: unknown[] = [];
      if (dto.accountHolderName !== undefined) {
        rawFields.push('"accountHolderName"');
        rawValues.push(dto.accountHolderName.trim() || null);
      }
      if (dto.bankCode !== undefined) {
        rawFields.push('"bankCode"');
        rawValues.push(dto.bankCode.trim() || null);
      }
      if (dto.swiftCode !== undefined) {
        rawFields.push('"swiftCode"');
        rawValues.push(dto.swiftCode.trim() || null);
      }
      if (dto.province !== undefined) {
        rawFields.push('"province"');
        rawValues.push(dto.province.trim() || null);
      }
      if (dto.lunchEnabled !== undefined) {
        rawFields.push('"lunchEnabled"');
        rawValues.push(dto.lunchEnabled);
      }
      if (dto.incomeTaxAmount !== undefined) {
        rawFields.push('"incomeTaxAmount"');
        rawValues.push(dto.incomeTaxAmount);
      }
      if (rawFields.length > 0) {
        const setClauses = rawFields.map((f, i) => `${f} = $${i + 1}`).join(', ');
        await tx.$executeRawUnsafe(
          `UPDATE users SET ${setClauses} WHERE id = $${rawFields.length + 1}`,
          ...rawValues,
          id,
        );
      }

      const targetYear =
        dto.joiningDate?.getFullYear() ??
        existing.joiningDate?.getFullYear() ??
        new Date().getFullYear();

      const casual =
        dto.casualLeaveBalance !== undefined
          ? dto.casualLeaveBalance
          : (existing.casualLeaveBalance ?? null);
      const sick =
        dto.sickLeaveBalance !== undefined
          ? dto.sickLeaveBalance
          : (existing.sickLeaveBalance ?? null);

      if (casual !== null || sick !== null) {
        await tx.leaveBalance.upsert({
          where: { userId_year: { userId: id, year: targetYear } },
          create: {
            userId: id,
            year: targetYear,
            casualBalance: casual ?? 0,
            sickBalance: sick ?? 0,
            casualUsed: 0,
            sickUsed: 0,
          },
          update: {
            ...(casual !== null ? { casualBalance: casual } : {}),
            ...(sick !== null ? { sickBalance: sick } : {}),
          },
        });
      }

      return user;
    });

    await this.cacheManager.del(`user:${id}`);

    // Emit tier changed event if tier was modified
    if (dto.tier !== undefined && dto.tier !== existing.tier && adminId) {
      this.eventEmitter.emit(
        'user.tier-changed',
        new UserTierChangedEvent(
          id,
          existing.email,
          existing.name,
          existing.tier,
          dto.tier,
          adminId,
          new Date(),
        ),
      );
    }

    const [hasReviewContributionPermission, rawExtra] = await Promise.all([
      this.aclService.userHasEntityAccess(id, CONTRIBUTION_REVIEW_ENTITY),
      this.prisma.$queryRaw<
        {
          accountHolderName: string | null;
          bankCode: string | null;
          swiftCode: string | null;
          province: string | null;
          lunchEnabled: boolean;
          incomeTaxAmount: string | null;
        }[]
      >`SELECT "accountHolderName", "bankCode", "swiftCode", "province", "lunchEnabled", "incomeTaxAmount" FROM users WHERE id = ${id}`,
    ]);

    const rawExtraFields = rawExtra[0]
      ? {
          ...rawExtra[0],
          incomeTaxAmount:
            rawExtra[0].incomeTaxAmount != null ? Number(rawExtra[0].incomeTaxAmount) : null,
        }
      : {};

    return {
      ...updated,
      ...rawExtraFields,
      hasReviewContributionPermission,
    } as unknown as UserResponseDto;
  }

  /**
   * Send welcome email (first time) or resend password credentials.
   * First time: full welcome template. Resend: credentials-only template.
   */
  async sendWelcomeEmail(userId: string): Promise<{
    message: string;
    queuedTo: string[];
    welcomeEmailSentAt: Date;
    isResend: boolean;
  }> {
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

    const isResend = !!user.welcomeEmailSentAt;
    const tempPassword = this.generateTempPassword();
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

    // Invalidate existing refresh tokens so any active sessions are logged out
    await this.tokenService.invalidateRefreshTokens(userId);

    const loginUrl = `${getFrontendUrl()}/login`;

    let subject: string;
    let html: string;

    if (isResend) {
      subject = 'DevsLoop Vault – Your login credentials';
      html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h1 style="color: #2563eb;">Your login credentials</h1>
        <p>Hi ${user.name},</p>
        <p>Your administrator has resent your password credentials. Use the details below to sign in.</p>
        <div style="background-color: #f3f4f6; padding: 16px; border-radius: 8px; margin: 20px 0;">
          <p style="margin: 0 0 8px 0;"><strong>Login URL:</strong></p>
          <p style="margin: 0 0 12px 0;"><a href="${loginUrl}">${loginUrl}</a></p>
          <p style="margin: 0 0 8px 0;"><strong>Email:</strong> ${user.email}</p>
          <p style="margin: 0;"><strong>New temporary password:</strong> <code style="background: #e5e7eb; padding: 2px 6px;">${tempPassword}</code></p>
        </div>
        <p>You will be asked to change your password after signing in.</p>
        <div style="margin-top: 20px;">
          <a href="${loginUrl}"
             style="background-color: #2563eb; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block;">
            Sign in to DevsLoop Vault
          </a>
        </div>
        <p style="margin-top: 30px; color: #6b7280; font-size: 12px;">
          If you did not request this, please contact your administrator.
        </p>
      </div>
    `;
    } else {
      const roleNames =
        user.userRoleAssignments?.map((a) => a.role.displayName).filter(Boolean) ?? [];
      const rolesHtml =
        roleNames.length > 0
          ? `<p>You have been assigned the following role(s):</p><ul>${roleNames.map((r) => `<li><strong>${r}</strong></li>`).join('')}</ul>`
          : '<p>Your administrator has set up your account.</p>';
      subject = 'DevsLoop Vault – Welcome! Your account and password';
      html = `
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
    }

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
    this.logger.log(
      `${isResend ? 'Credentials' : 'Welcome'} email queued for user ${userId} to: ${queuedTo.join(', ')}`,
    );
    return {
      message: isResend ? 'Password credentials queued.' : 'Welcome email queued successfully.',
      queuedTo,
      welcomeEmailSentAt: sentAt,
      isResend,
    };
  }

  /**
   * Send welcome / credentials email to multiple users in bulk.
   * Processes each user sequentially to avoid flooding the queue.
   */
  async bulkSendWelcomeEmail(userIds: string[]): Promise<{
    sent: number;
    failed: number;
    results: Array<{
      userId: string;
      email: string;
      success: boolean;
      isResend: boolean;
      error?: string;
    }>;
  }> {
    const results: Array<{
      userId: string;
      email: string;
      success: boolean;
      isResend: boolean;
      error?: string;
    }> = [];

    for (const userId of userIds) {
      try {
        const result = await this.sendWelcomeEmail(userId);
        results.push({
          userId,
          email: result.queuedTo[0] ?? '',
          success: true,
          isResend: result.isResend,
        });
      } catch (err) {
        const error = err instanceof Error ? err.message : 'Unknown error';
        results.push({ userId, email: '', success: false, isResend: false, error });
      }
    }

    return {
      sent: results.filter((r) => r.success).length,
      failed: results.filter((r) => !r.success).length,
      results,
    };
  }

  /**
   * Get paginated salary report for all approved employees.
   * Supports filtering by department, employeeType, employeeStatus, and free-text search.
   * Returns salary data for admin/HR use only (protected by 'user' entity permission).
   */
  async getSalaryReport(query: SalaryReportQueryDto): Promise<{
    data: Array<{
      id: string;
      name: string;
      email: string;
      employeeId: string | null;
      departments: string[];
      designation: string | null;
      employeeType: string | null;
      employeeStatus: string | null;
      baseSalaryMonthly: string | null;
      joiningDate: Date | null;
    }>;
    total: number;
    page: number;
    limit: number;
    totalPages: number;
    hasNextPage: boolean;
    hasPreviousPage: boolean;
    totalPayroll: number;
  }> {
    const {
      page = 1,
      limit = 20,
      search,
      department,
      employeeType,
      employeeStatus,
      sortBy = 'name',
      sortOrder = 'asc',
    } = query;

    // Build where clause
    const where: Prisma.UserWhereInput = {
      approvalStatus: 'APPROVED',
      isSystem: false,
    };

    if (search?.trim()) {
      const s = search.trim();
      where.OR = [
        { name: { contains: s, mode: 'insensitive' } },
        { email: { contains: s, mode: 'insensitive' } },
      ];
    }

    if (department?.trim()) {
      where.departments = { has: department.trim() };
    }

    if (employeeType?.trim()) {
      where.employeeType = employeeType.trim() as never;
    }

    if (employeeStatus?.trim()) {
      where.employeeStatus = employeeStatus.trim() as EmployeeStatus;
    }

    // Build order by
    const orderByMap: Record<string, Prisma.UserOrderByWithRelationInput> = {
      name: { name: sortOrder },
      department: { name: sortOrder }, // fallback to name when sorting by department
      salary: { baseSalaryMonthly: sortOrder },
      joiningDate: { joiningDate: sortOrder },
    };
    const orderBy = orderByMap[sortBy] ?? { name: 'asc' };

    const skip = (page - 1) * limit;

    const [users, total, salaryAggregate] = await Promise.all([
      this.prisma.user.findMany({
        where,
        orderBy,
        skip,
        take: limit,
        select: {
          id: true,
          name: true,
          email: true,
          employeeId: true,
          departments: true,
          designation: true,
          employeeType: true,
          employeeStatus: true,
          baseSalaryMonthly: true,
          joiningDate: true,
        },
      }),
      this.prisma.user.count({ where }),
      this.prisma.user.aggregate({
        where: { ...where, baseSalaryMonthly: { not: null } },
        _sum: { baseSalaryMonthly: true },
      }),
    ]);

    const totalPages = Math.ceil(total / limit);

    return {
      data: users.map((u) => ({
        id: u.id,
        name: u.name,
        email: u.email,
        employeeId: u.employeeId ?? null,
        departments: u.departments,
        designation: u.designation ?? null,
        employeeType: u.employeeType ?? null,
        employeeStatus: u.employeeStatus ?? null,
        baseSalaryMonthly: u.baseSalaryMonthly?.toString() ?? null,
        joiningDate: u.joiningDate ?? null,
      })),
      total,
      page,
      limit,
      totalPages,
      hasNextPage: page < totalPages,
      hasPreviousPage: page > 1,
      totalPayroll: Number(salaryAggregate._sum.baseSalaryMonthly ?? 0),
    };
  }
}
