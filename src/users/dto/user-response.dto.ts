import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ApprovalStatus, WarningType } from '@prisma/client';

/** Warning item included in user detail response */
export class UserWarningItemDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  userId: string;

  @ApiProperty()
  message: string;

  @ApiProperty({ enum: WarningType, default: WarningType.MINOR })
  warningType: WarningType;

  @ApiProperty()
  createdAt: string;

  @ApiPropertyOptional()
  createdByName?: string;
}

/** Minimal contribution summary for user detail */
export class UserContributionSummaryDto {
  @ApiProperty()
  id: string;

  @ApiProperty({ description: 'Problem statement (may be truncated)' })
  problem: string;

  @ApiProperty()
  status: string;

  @ApiProperty()
  createdAt: string;

  @ApiProperty({ description: 'Project name' })
  projectName: string;
}

/** Minimal project info for assigned-projects list (e.g. in admin users list) */
export class AssignedProjectItemDto {
  @ApiProperty({ description: 'Project ID' })
  id: string;

  @ApiProperty({ description: 'Project name' })
  name: string;
}

export class UserRoleAssignmentDto {
  @ApiProperty({ description: 'Whether this is the primary role' })
  isPrimary: boolean;

  @ApiProperty({ description: 'Role details' })
  role: {
    id: string;
    name: string;
    displayName: string;
    description?: string | null;
  };
}

export class UserResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  email: string;

  @ApiPropertyOptional({ description: 'Personal email (non-login)', example: 'john.doe@gmail.com' })
  personalEmail?: string | null;

  @ApiProperty()
  name: string;

  @ApiPropertyOptional({
    type: [UserRoleAssignmentDto],
    description: 'User role assignments (from UserRoleAssignment table)',
  })
  userRoleAssignments?: UserRoleAssignmentDto[];

  @ApiProperty({ description: 'Departments the user belongs to', type: [String], default: [] })
  departments: string[];

  @ApiPropertyOptional({ description: 'Employee designation / job title' })
  designation?: string | null;

  @ApiPropertyOptional({ description: 'Employee joining date' })
  joiningDate?: Date | null;

  @ApiPropertyOptional({ description: 'Employee leave date' })
  leaveDate?: Date | null;

  @ApiPropertyOptional({
    description: 'Monthly base salary (stored as decimal, returned as string)',
    example: '5000.00',
  })
  baseSalaryMonthly?: string | null;

  @ApiPropertyOptional({ description: 'Casual leave balance (days)', example: 10 })
  casualLeaveBalance?: number;

  @ApiPropertyOptional({ description: 'Sick leave balance (days)', example: 8 })
  sickLeaveBalance?: number;

  @ApiPropertyOptional({ description: 'Annual leave balance (days)', example: 14 })
  annualLeaveBalance?: number;

  @ApiPropertyOptional()
  avatarUrl: string | null;

  @ApiProperty()
  isSystem: boolean;

  @ApiProperty()
  emailVerified: boolean;

  @ApiProperty()
  hasAccess: number;

  @ApiProperty({ enum: ApprovalStatus })
  approvalStatus: ApprovalStatus;

  @ApiPropertyOptional({ description: 'When admin reviewed (approved/rejected)' })
  reviewedAt: Date | null;

  @ApiPropertyOptional({
    description: 'When the welcome email (with password) was sent; null if not sent yet',
  })
  welcomeEmailSentAt?: Date | null;

  @ApiPropertyOptional()
  rejectionReason: string | null;

  @ApiPropertyOptional({ description: 'Admin who reviewed (approved/rejected)' })
  reviewedBy: {
    id: string;
    name: string;
    email: string;
  } | null;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;

  @ApiProperty({
    description:
      'Whether the user has permission to review contributions (contribution-review entity)',
    example: true,
  })
  hasReviewContributionPermission: boolean;

  @ApiPropertyOptional({
    description: 'Projects assigned to this user (included only in GET /admin/users list)',
    type: [AssignedProjectItemDto],
    default: [],
  })
  assignedProjects?: AssignedProjectItemDto[];

  @ApiPropertyOptional({
    description: 'Warnings recorded for this user (included in GET /admin/users/:id detail)',
    type: [UserWarningItemDto],
    default: [],
  })
  warnings?: UserWarningItemDto[];

  @ApiPropertyOptional({
    description: 'Contributions by this user (included in GET /admin/users/:id detail)',
    type: [UserContributionSummaryDto],
    default: [],
  })
  contributions?: UserContributionSummaryDto[];

  @ApiPropertyOptional({
    description: 'Total number of contributions by this user',
    example: 12,
  })
  contributionCount?: number;
}

export class PaginatedUsersResponseDto {
  @ApiProperty({ type: [UserResponseDto] })
  data: UserResponseDto[];

  @ApiProperty()
  total: number;

  @ApiProperty({ description: 'Count of users with PENDING approval status' })
  pendingTotal: number;

  @ApiProperty({ description: 'Count of users with APPROVED approval status' })
  approvedTotal: number;

  @ApiProperty({ description: 'Count of users with REJECTED approval status' })
  rejectedTotal: number;

  @ApiProperty({ description: 'Count of approved users with active access' })
  activeTotal: number;

  @ApiProperty({ description: 'Count of approved users with revoked access' })
  inactiveTotal: number;

  @ApiProperty({ description: 'Count of approved users who have not changed their password yet' })
  passwordPendingTotal: number;

  @ApiProperty()
  page: number;

  @ApiProperty()
  limit: number;

  @ApiProperty()
  totalPages: number;

  @ApiProperty()
  hasNextPage: boolean;

  @ApiProperty()
  hasPreviousPage: boolean;
}
