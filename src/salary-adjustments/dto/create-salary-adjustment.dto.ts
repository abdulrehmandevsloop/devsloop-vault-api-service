import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
} from 'class-validator';
import { SalaryAdjustmentCategory, SalaryAdjustmentType } from '@prisma/client';

export class CreateSalaryAdjustmentDto {
  @ApiProperty({ description: 'Employee user CUID', example: 'clx...' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(30)
  employeeId: string;

  @ApiProperty({ description: 'Target month YYYY-MM', example: '2026-05' })
  @IsString()
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/, { message: 'yearMonth must be in YYYY-MM format' })
  yearMonth: string;

  @ApiProperty({ enum: SalaryAdjustmentCategory })
  @IsEnum(SalaryAdjustmentCategory)
  category: SalaryAdjustmentCategory;

  @ApiProperty({ enum: SalaryAdjustmentType })
  @IsEnum(SalaryAdjustmentType)
  type: SalaryAdjustmentType;

  @ApiProperty({ description: 'Adjustment amount in PKR (always positive)', example: 5000 })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Type(() => Number)
  amount: number;

  @ApiProperty({ description: 'Mandatory reason / remarks', example: 'Q1 increment' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  reason: string;

  @ApiPropertyOptional({
    description:
      'For SALARY_INCREMENT only — if true apply to current pending payroll, else from next month.',
  })
  @IsOptional()
  @IsBoolean()
  applyToCurrent?: boolean;
}
