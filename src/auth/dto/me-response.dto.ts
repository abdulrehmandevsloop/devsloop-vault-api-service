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

  @ApiPropertyOptional({ nullable: true })
  role: {
    // id: string;
    name: string;
    displayName: string;
    // description?: string | null;
  } | null;

  @ApiPropertyOptional()
  department: string | null;

  @ApiPropertyOptional()
  avatarUrl: string | null;

  @ApiProperty()
  emailVerified: boolean;

  @ApiProperty()
  hasAccess: number;

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
