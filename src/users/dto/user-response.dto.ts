import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ApprovalStatus } from '@prisma/client';

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

  @ApiProperty()
  name: string;

  @ApiPropertyOptional({
    type: [UserRoleAssignmentDto],
    description: 'User role assignments (from UserRoleAssignment table)',
  })
  userRoleAssignments?: UserRoleAssignmentDto[];

  @ApiPropertyOptional()
  department: string | null;

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
}

export class PaginatedUsersResponseDto {
  @ApiProperty({ type: [UserResponseDto] })
  data: UserResponseDto[];

  @ApiProperty()
  total: number;

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
