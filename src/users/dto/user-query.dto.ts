import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsDate,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
  MaxLength,
} from 'class-validator';
import { ApprovalStatus } from '@prisma/client';

export class UserQueryDto {
  @ApiPropertyOptional({ description: 'Search by name or email' })
  @IsOptional()
  @IsString({ message: 'Search query must be a string' })
  @MaxLength(255, { message: 'Search query must not exceed 255 characters' })
  search?: string;

  @ApiPropertyOptional({
    enum: ApprovalStatus,
    description: 'Filter by approval status',
  })
  @IsOptional()
  @IsEnum(ApprovalStatus, {
    message: 'Approval status must be one of: PENDING, APPROVED, REJECTED',
  })
  approvalStatus?: ApprovalStatus;

  @ApiPropertyOptional({ description: 'Filter by access status (1 = active, 0 = inactive)' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  hasAccess?: number;

  @ApiPropertyOptional({ description: 'Filter by must-change-password flag' })
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  mustChangePassword?: boolean;

  @ApiPropertyOptional({
    description: 'Filter by role ID',
    example: 'clx1234567890',
  })
  @IsOptional()
  @IsString({ message: 'Role ID must be a string' })
  @MaxLength(100, { message: 'Role ID must not exceed 100 characters' })
  roleId?: string;

  @ApiPropertyOptional({ description: 'Filter by department' })
  @IsOptional()
  @IsString({ message: 'Department must be a string' })
  @MaxLength(100, { message: 'Department must not exceed 100 characters' })
  department?: string;

  @ApiPropertyOptional({ description: 'Filter by email verified status' })
  @IsOptional()
  @Type(() => Boolean)
  emailVerified?: boolean;

  @ApiPropertyOptional({
    description: 'Filter users created from this date (ISO 8601)',
    example: '2024-01-01T00:00:00.000Z',
  })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  createdFrom?: Date;

  @ApiPropertyOptional({
    description: 'Filter users created until this date (ISO 8601)',
    example: '2024-12-31T23:59:59.999Z',
  })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  createdTo?: Date;

  @ApiPropertyOptional({
    description: 'Filter users reviewed (approved/rejected) from this date (ISO 8601)',
    example: '2024-01-01T00:00:00.000Z',
  })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  reviewedFrom?: Date;

  @ApiPropertyOptional({
    description: 'Filter users reviewed (approved/rejected) until this date (ISO 8601)',
    example: '2024-12-31T23:59:59.999Z',
  })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  reviewedTo?: Date;

  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ default: 10, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 10;

  @ApiPropertyOptional({
    description: 'Sort field',
    enum: ['createdAt', 'name', 'email', 'approvalStatus', 'reviewedAt'],
    default: 'createdAt',
  })
  @IsOptional()
  @IsString({ message: 'Sort field must be a string' })
  @MaxLength(50, { message: 'Sort field must not exceed 50 characters' })
  sortBy?: string = 'createdAt';

  @ApiPropertyOptional({
    description: 'Sort order',
    enum: ['asc', 'desc'],
    default: 'desc',
  })
  @IsOptional()
  @IsString({ message: 'Sort order must be a string' })
  @MaxLength(10, { message: 'Sort order must not exceed 10 characters' })
  sortOrder?: 'asc' | 'desc' = 'desc';
}
