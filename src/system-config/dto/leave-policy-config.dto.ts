import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Min } from 'class-validator';

export class LeavePolicyConfigDto {
  @ApiProperty({ description: 'Maximum maternity leave days per year', example: 22 })
  maternityMaxDays: number;

  @ApiProperty({ description: 'Default WFH days allowed per month (global fallback)', example: 1 })
  wfhPerMonth: number;

  @ApiProperty({ description: 'Maximum wedding leave days', example: 5 })
  weddingMaxDays: number;

  @ApiProperty({ description: 'Maximum Umrah/Hajj leave days', example: 10 })
  umrahHajjMaxDays: number;

  @ApiProperty({
    description: 'Minimum months of service before Umrah/Hajj leave is eligible',
    example: 12,
  })
  umrahHajjMinServiceMonths: number;

  @ApiProperty({ description: 'Minimum advance notice days required for casual leave', example: 3 })
  casualAdvanceNoticeDays: number;

  @ApiProperty({ description: 'Minimum advance notice days required for WFH', example: 1 })
  wfhAdvanceNoticeDays: number;

  @ApiProperty({
    description: 'Minimum advance notice days required for multi-day leave',
    example: 7,
  })
  multiDayAdvanceNoticeDays: number;
}

export class UpdateLeavePolicyConfigDto {
  @ApiPropertyOptional({ description: 'Maximum maternity leave days per year' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Type(() => Number)
  maternityMaxDays?: number;

  @ApiPropertyOptional({ description: 'Default WFH days allowed per month' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Type(() => Number)
  wfhPerMonth?: number;

  @ApiPropertyOptional({ description: 'Maximum wedding leave days' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Type(() => Number)
  weddingMaxDays?: number;

  @ApiPropertyOptional({ description: 'Maximum Umrah/Hajj leave days' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Type(() => Number)
  umrahHajjMaxDays?: number;

  @ApiPropertyOptional({ description: 'Minimum months of service for Umrah/Hajj eligibility' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Type(() => Number)
  umrahHajjMinServiceMonths?: number;

  @ApiPropertyOptional({ description: 'Minimum advance notice days for casual leave' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Type(() => Number)
  casualAdvanceNoticeDays?: number;

  @ApiPropertyOptional({ description: 'Minimum advance notice days for WFH' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Type(() => Number)
  wfhAdvanceNoticeDays?: number;

  @ApiPropertyOptional({ description: 'Minimum advance notice days for multi-day leave' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Type(() => Number)
  multiDayAdvanceNoticeDays?: number;
}
