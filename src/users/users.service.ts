import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../prisma';
import { ApprovalStatus, Prisma } from '@prisma/client';
import {
  UserQueryDto,
  ApproveUserDto,
  RejectUserDto,
  PaginatedUsersResponseDto,
  UserResponseDto,
} from './dto';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Get paginated list of users with filters and search
   */
  async findAll(query: UserQueryDto): Promise<PaginatedUsersResponseDto> {
    const {
      search,
      approvalStatus,
      role,
      department,
      emailVerified,
      createdFrom,
      createdTo,
      reviewedFrom,
      reviewedTo,
      page = 1,
      limit = 10,
      sortBy = 'createdAt',
      sortOrder = 'desc',
    } = query;

    // Build where clause
    const where: Prisma.UserWhereInput = {};

    // Filter by approval status
    if (approvalStatus) {
      where.approvalStatus = approvalStatus;
    }

    // Filter by role
    if (role) {
      where.role = role;
    }

    // Filter by department (partial match, case insensitive)
    if (department) {
      where.department = { contains: department, mode: 'insensitive' };
    }

    // Filter by email verified
    if (emailVerified !== undefined) {
      where.emailVerified = emailVerified;
    }

    // Filter by createdAt date range
    if (createdFrom || createdTo) {
      where.createdAt = {};
      if (createdFrom) {
        where.createdAt.gte = createdFrom;
      }
      if (createdTo) {
        where.createdAt.lte = createdTo;
      }
    }

    // Filter by reviewedAt date range
    if (reviewedFrom || reviewedTo) {
      where.reviewedAt = {};
      if (reviewedFrom) {
        where.reviewedAt.gte = reviewedFrom;
      }
      if (reviewedTo) {
        where.reviewedAt.lte = reviewedTo;
      }
    }

    // Search by name or email
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
      ];
    }

    // Calculate pagination
    const skip = (page - 1) * limit;

    // Build orderBy
    const orderBy: Prisma.UserOrderByWithRelationInput = {};
    const validSortFields = [
      'createdAt',
      'name',
      'email',
      'approvalStatus',
      'role',
      'department',
      'reviewedAt',
    ];
    if (validSortFields.includes(sortBy)) {
      orderBy[sortBy] = sortOrder;
    } else {
      orderBy.createdAt = 'desc';
    }

    // Execute queries in parallel
    const [users, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        skip,
        take: limit,
        orderBy,
        select: {
          id: true,
          email: true,
          name: true,
          role: true,
          department: true,
          avatarUrl: true,
          emailVerified: true,
          approvalStatus: true,
          reviewedAt: true,
          rejectionReason: true,
          createdAt: true,
          updatedAt: true,
          reviewedBy: {
            select: {
              id: true,
              name: true,
              email: true,
            },
          },
        },
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
    console.log('findPendingRequests', query);
    return this.findAll({
      ...query,
      approvalStatus: ApprovalStatus.PENDING,
    });
  }

  /**
   * Get a single user by ID
   */
  async findOne(id: string): Promise<UserResponseDto> {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        department: true,
        avatarUrl: true,
        emailVerified: true,
        approvalStatus: true,
        reviewedAt: true,
        rejectionReason: true,
        createdAt: true,
        updatedAt: true,
        reviewedBy: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
    });

    if (!user) {
      throw new NotFoundException(`User with ID ${id} not found`);
    }

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
    });

    if (!user) {
      throw new NotFoundException(`User with ID ${userId} not found`);
    }

    // Cannot approve yourself
    if (userId === adminId) {
      throw new ForbiddenException('You cannot approve yourself');
    }

    // Check if already processed
    if (user.approvalStatus !== ApprovalStatus.PENDING) {
      throw new BadRequestException(`User has already been ${user.approvalStatus.toLowerCase()}`);
    }

    // Update user
    const updatedUser = await this.prisma.user.update({
      where: { id: userId },
      data: {
        approvalStatus: ApprovalStatus.APPROVED,
        role: dto.role,
        department: dto.department,
        reviewedById: adminId,
        reviewedAt: new Date(),
        rejectionReason: null,
      },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        department: true,
        avatarUrl: true,
        emailVerified: true,
        approvalStatus: true,
        reviewedAt: true,
        rejectionReason: true,
        createdAt: true,
        updatedAt: true,
        reviewedBy: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
    });

    return updatedUser;
  }

  /**
   * Reject a user
   */
  async rejectUser(userId: string, adminId: string, dto: RejectUserDto): Promise<UserResponseDto> {
    // Check if user exists
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new NotFoundException(`User with ID ${userId} not found`);
    }

    // Cannot reject yourself
    if (userId === adminId) {
      throw new ForbiddenException('You cannot reject yourself');
    }

    // Check if already processed
    if (user.approvalStatus !== ApprovalStatus.PENDING) {
      throw new BadRequestException(`User has already been ${user.approvalStatus.toLowerCase()}`);
    }

    // Update user
    const updatedUser = await this.prisma.user.update({
      where: { id: userId },
      data: {
        approvalStatus: ApprovalStatus.REJECTED,
        role: null,
        reviewedById: adminId,
        reviewedAt: new Date(),
        rejectionReason: dto.reason || null,
      },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        department: true,
        avatarUrl: true,
        emailVerified: true,
        approvalStatus: true,
        reviewedAt: true,
        rejectionReason: true,
        createdAt: true,
        updatedAt: true,
        reviewedBy: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
    });

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
}
