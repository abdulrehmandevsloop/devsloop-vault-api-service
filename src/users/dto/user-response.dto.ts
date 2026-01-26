import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ApprovalStatus, UserRole } from '@prisma/client';

export class UserResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  email: string;

  @ApiProperty()
  name: string;

  @ApiPropertyOptional({ enum: UserRole, nullable: true })
  role: UserRole | null;

  @ApiPropertyOptional()
  department: string | null;

  @ApiPropertyOptional()
  avatarUrl: string | null;

  @ApiProperty()
  emailVerified: boolean;

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
