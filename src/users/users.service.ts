import { Injectable, NotFoundException, Inject, BadRequestException } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../prisma';
import { ApprovalStatus } from '@prisma/client';
import {
  UserQueryDto,
  ApproveUserDto,
  RejectUserDto,
  ToggleStatusDto,
  PaginatedUsersResponseDto,
  UserResponseDto,
} from './dto';
import { UserQueryService, UserValidationService } from './services';
import { USER_SELECT_FIELDS } from './interfaces';
import { UserApprovedEvent, UserRejectedEvent, UserStatusChangedEvent } from './events';
import { TokenService } from '../auth/services/token.service';

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly userQueryService: UserQueryService,
    private readonly userValidationService: UserValidationService,
    private readonly eventEmitter: EventEmitter2,
    private readonly tokenService: TokenService,
    @Inject(CACHE_MANAGER) private cacheManager: Cache,
  ) {}

  /**
   * Get paginated list of users with filters and search
   */
  async findAll(query: UserQueryDto): Promise<PaginatedUsersResponseDto> {
    const { page = 1, limit = 10, sortBy = 'createdAt', sortOrder = 'desc' } = query;

    // Build query clauses using query service
    const where = this.userQueryService.buildWhereClause(query);
    const orderBy = this.userQueryService.buildOrderByClause(sortBy, sortOrder);
    const pagination = this.userQueryService.calculatePagination(page, limit);

    // Execute queries in parallel
    const [users, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        ...pagination,
        orderBy,
        select: USER_SELECT_FIELDS,
      }),
      this.prisma.user.count({ where }),
    ]);

    const totalPages = Math.ceil(total / limit);

    return {
      data: users,
      total,
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
  ): Promise<PaginatedUsersResponseDto> {
    return this.findAll({
      ...query,
      approvalStatus: ApprovalStatus.PENDING,
    });
  }

  /**
   * Get a single user by ID (with caching)
   */
  async findOne(id: string): Promise<UserResponseDto> {
    const cacheKey = `user:${id}`;

    // Check cache first
    const cached = await this.cacheManager.get<UserResponseDto>(cacheKey);
    if (cached) {
      return cached;
    }

    // Query database
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: USER_SELECT_FIELDS,
    });

    if (!user) {
      throw new NotFoundException(`User with ID ${id} not found`);
    }

    // Store in cache (5 minutes)
    await this.cacheManager.set(cacheKey, user, 300);

    return user;
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
      select: { approvalStatus: true },
    });

    if (!user) {
      throw new NotFoundException(`User with ID ${userId} not found`);
    }

    // Validate user action
    this.userValidationService.validateUserAction(userId, adminId, user.approvalStatus, 'approve');

    // Verify role exists
    const role = await this.prisma.role.findUnique({
      where: { id: dto.roleId },
    });

    if (!role) {
      throw new NotFoundException(`Role with ID ${dto.roleId} not found`);
    }

    // Get user details for event and check if role is changing
    const existingUser = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { email: true, name: true, approvalStatus: true, roleId: true },
    });

    const roleChanged = existingUser?.roleId !== dto.roleId;

    // Update user
    const updatedUser = await this.prisma.user.update({
      where: { id: userId },
      data: {
        approvalStatus: ApprovalStatus.APPROVED,
        roleId: dto.roleId,
        department: dto.department,
        reviewedById: adminId,
        reviewedAt: new Date(),
        rejectionReason: null,
      },
      select: USER_SELECT_FIELDS,
    });

    // Invalidate cache
    await this.cacheManager.del(`user:${userId}`);

    // If role changed, invalidate all user tokens to force re-authentication
    // This ensures the new role is immediately effective
    if (roleChanged) {
      await this.tokenService.invalidateRefreshTokens(userId);
    }

    // Emit event for email and audit (async, non-blocking)
    if (existingUser) {
      this.eventEmitter.emit(
        'user.approved',
        new UserApprovedEvent(
          userId,
          existingUser.email,
          existingUser.name,
          adminId,
          existingUser.approvalStatus,
          ApprovalStatus.APPROVED,
        ),
      );
    }

    return updatedUser;
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

    // Get current roleId to check if role is being removed
    const currentUser = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { roleId: true },
    });

    const roleRemoved = currentUser?.roleId !== null;

    // Update user
    const updatedUser = await this.prisma.user.update({
      where: { id: userId },
      data: {
        approvalStatus: ApprovalStatus.REJECTED,
        roleId: null,
        reviewedById: adminId,
        reviewedAt: new Date(),
        rejectionReason: dto.reason || null,
      },
      select: USER_SELECT_FIELDS,
    });

    // Invalidate cache
    await this.cacheManager.del(`user:${userId}`);

    // If role was removed, invalidate all user tokens
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

    return updatedUser;
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

    return updatedUser;
  }
}
