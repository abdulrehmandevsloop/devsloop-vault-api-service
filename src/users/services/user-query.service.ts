import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { UserQueryDto } from '../dto';

@Injectable()
export class UserQueryService {
  /**
   * Build Prisma where clause from query DTO
   */
  buildWhereClause(query: UserQueryDto): Prisma.UserWhereInput {
    const {
      search,
      approvalStatus,
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

    // Filter by roleId (via UserRoleAssignment)
    if (roleId) {
      where.userRoleAssignments = {
        some: { roleId },
      };
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

    return where;
  }

  /**
   * Build Prisma orderBy clause from query DTO
   */
  buildOrderByClause(
    sortBy?: string,
    sortOrder?: 'asc' | 'desc',
  ): Prisma.UserOrderByWithRelationInput {
    const validSortFields = [
      'createdAt',
      'name',
      'email',
      'approvalStatus',
      'department',
      'reviewedAt',
    ];

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
