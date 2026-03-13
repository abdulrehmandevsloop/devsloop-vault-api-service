import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export type SalaryReportSortBy = 'name' | 'department' | 'salary' | 'joiningDate';
export type SortOrder = 'asc' | 'desc';

export class SalaryReportQueryDto {
  @ApiPropertyOptional({ description: 'Search by name, email, or employee ID' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  search?: string;

  @ApiPropertyOptional({ description: 'Filter by department' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  department?: string;

  @ApiPropertyOptional({
    description: 'Filter by employee type',
    enum: ['FULL_TIME', 'CONTRACT', 'INTERN', 'CONSULTANT'],
  })
  @IsOptional()
  @IsString()
  employeeType?: string;

  @ApiPropertyOptional({
    description: 'Filter by employee status',
    enum: ['ACTIVE', 'INACTIVE', 'ON_LEAVE', 'TERMINATED'],
  })
  @IsOptional()
  @IsString()
  employeeStatus?: string;

  @ApiPropertyOptional({
    description: 'Sort field',
    enum: ['name', 'department', 'salary', 'joiningDate'],
    default: 'name',
  })
  @IsOptional()
  @IsEnum(['name', 'department', 'salary', 'joiningDate'])
  sortBy?: SalaryReportSortBy;

  @ApiPropertyOptional({
    description: 'Sort order',
    enum: ['asc', 'desc'],
    default: 'asc',
  })
  @IsOptional()
  @IsEnum(['asc', 'desc'])
  sortOrder?: SortOrder;

  @ApiPropertyOptional({ description: 'Page number', minimum: 1, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ description: 'Items per page', minimum: 1, maximum: 200, default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;
}
