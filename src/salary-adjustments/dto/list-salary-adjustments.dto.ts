import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
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
}
