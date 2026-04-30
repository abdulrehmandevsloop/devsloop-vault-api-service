import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';
import { SalaryAdjustmentStatus } from '@prisma/client';

export class ListSalaryAdjustmentsDto {
  @ApiPropertyOptional({ enum: SalaryAdjustmentStatus })
  @IsOptional()
  @IsEnum(SalaryAdjustmentStatus)
  status?: SalaryAdjustmentStatus;

  @ApiPropertyOptional({ example: '2026-05' })
  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/)
  yearMonth?: string;

  @ApiPropertyOptional({ description: 'Employee CUID filter' })
  @IsOptional()
  @IsString()
  @MaxLength(30)
  employeeId?: string;

  @ApiPropertyOptional({
    description: 'Page number (omit with limit for unlimited legacy list)',
    minimum: 1,
    default: 1,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  /** When set (or when page is set), results are paginated; max 1000. */
  @ApiPropertyOptional({ description: 'Page size', minimum: 1, maximum: 1000, default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1000)
  limit?: number;
}
