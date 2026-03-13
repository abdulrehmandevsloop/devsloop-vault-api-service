import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ApprovalStatus } from '@prisma/client';

export class EntityPermissionDto {
  // @ApiProperty()
  // id: string;

  @ApiProperty()
  name: string;

  @ApiProperty()
  displayName: string;

  // @ApiPropertyOptional()
  // description?: string | null;

  // @ApiProperty({ enum: ['role', 'direct'], description: 'Source of permission' })
  // source: 'role' | 'direct';

  // @ApiPropertyOptional({ description: 'Role name if source is role' })
  // roleName?: string;

  // @ApiPropertyOptional({ description: 'Granted date if source is direct' })
  // grantedAt?: Date;
}

export class MeResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  email: string;

  @ApiProperty()
  name: string;

  // @ApiPropertyOptional({ nullable: true })
  // roleId: string | null;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Primary role (for backward compatibility)',
  })
  role: {
    name: string;
    displayName: string;
  } | null;

  @ApiPropertyOptional({
    description: 'All assigned roles (single source of truth from UserRoleAssignment)',
  })
  roles: {
    name: string;
    displayName: string;
    isPrimary: boolean;
  }[];

  @ApiProperty({ description: 'Departments the user belongs to', type: [String], default: [] })
  departments: string[];

  @ApiPropertyOptional()
  avatarUrl: string | null;

  @ApiPropertyOptional({ description: 'User bio for knowledge base profile' })
  bio: string | null;

  @ApiProperty()
  isSystem: boolean;

  @ApiProperty()
  emailVerified: boolean;

  @ApiProperty({
    description:
      'When true, user must change their password (e.g. temporary password from welcome email).',
  })
  mustChangePassword: boolean;

  @ApiProperty({ enum: ApprovalStatus })
  approvalStatus: ApprovalStatus;

  @ApiPropertyOptional({ description: 'When admin reviewed (approved/rejected)' })
  reviewedAt: Date | null;

  // @ApiPropertyOptional()
  // rejectionReason: string | null;

  @ApiPropertyOptional({ description: 'Admin who reviewed (approved/rejected)' })
  reviewedBy: {
    id: string;
    name: string;
    email: string;
  } | null;

  @ApiProperty({
    type: [EntityPermissionDto],
    description: 'Entity permissions from role and direct ACL',
  })
  permissions: EntityPermissionDto[];

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}
