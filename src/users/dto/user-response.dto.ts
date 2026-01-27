import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ApprovalStatus } from '@prisma/client';

export class UserResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  email: string;

  @ApiProperty()
  name: string;

  @ApiPropertyOptional({ nullable: true })
  roleId: string | null;

  @ApiPropertyOptional({ nullable: true })
  role: {
    id: string;
    name: string;
    displayName: string;
    description?: string | null;
    isSystem: boolean;
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
