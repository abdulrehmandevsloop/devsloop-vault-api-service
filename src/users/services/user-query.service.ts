import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { UserQueryDto } from '../dto';

@Injectable()
export class UserQueryService {
  private readonly logger = new Logger(UserQueryService.name);

  /**
   * Build Prisma where clause from query DTO
   */
  buildWhereClause(query: UserQueryDto): Prisma.UserWhereInput {
    const {
      search,
      approvalStatus,
      employeeStatus,
      mustChangePassword,
      roleId,
      department,
      emailVerified,
      createdFrom,
      createdTo,
      reviewedFrom,
      reviewedTo,
    } = query;

    const where: Prisma.UserWhereInput = {};

    // Filter by approval status
    if (approvalStatus) {
      where.approvalStatus = approvalStatus;
    }

    // Filter by employee status — INACTIVE is virtual: matches FREEZE + DEACTIVATED
    if (employeeStatus) {
      where.employeeStatus = employeeStatus === 'INACTIVE' ? { not: 'ACTIVE' } : employeeStatus;
    }

    // Filter by must-change-password (password pending)
    if (mustChangePassword !== undefined) {
      where.mustChangePassword = mustChangePassword;
    }

    // Filter by roleId (via UserRoleAssignment)
    if (roleId) {
      where.userRoleAssignments = {
        some: { roleId },
      };
    }

    // Filter by department (array hasSome match)
    if (department) {
      where.departments = { hasSome: [department] };
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

    // Search by name, email, or employee identifiers
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
        { employeeId: { contains: search, mode: 'insensitive' } },
      ];
    }

    return where;
  }

  /**
   * Build Prisma orderBy clause from query DTO
   */
  buildOrderByClause(
    sortBy?: string,
    sortOrder?: 'asc' | 'desc',
  ): Prisma.UserOrderByWithRelationInput {
    const validSortFields = ['createdAt', 'name', 'email', 'approvalStatus', 'reviewedAt'];

    const orderBy: Prisma.UserOrderByWithRelationInput = {};

    if (sortBy && validSortFields.includes(sortBy)) {
      orderBy[sortBy] = sortOrder || 'desc';
    } else {
      orderBy.createdAt = 'desc';
    }

    return orderBy;
  }

  /**
   * Calculate pagination parameters
   */
  calculatePagination(page: number = 1, limit: number = 10) {
    const skip = (page - 1) * limit;
    return { skip, take: limit };
  }
}
