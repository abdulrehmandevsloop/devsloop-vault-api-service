import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

enum ConsultantPayModeDto {
  FIXED = 'FIXED',
  DAILY_RATE = 'DAILY_RATE',
  HOURLY_RATE = 'HOURLY_RATE',
}

export class UpdatePayrollLineDto {
  @ApiPropertyOptional({
    description:
      'Optimistic concurrency version — must match the current version or update is rejected',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  version?: number;

  @ApiPropertyOptional({ description: 'Extra working days (overtime days at daily base rate)' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(31)
  extraWorkingDays?: number;

  @ApiPropertyOptional({
    description: 'Pending working days for FREEZE proration (final settlement)',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(31)
  pendingWorkingDays?: number | null;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  performanceBonus?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  reimbursementManual?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  includeHrReimbursements?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  fines?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  loanDeduction?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  advanceDeduction?: number;

  @ApiPropertyOptional({
    description: 'Income tax flat amount for this line (overrides user profile value)',
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  incomeTaxAmount?: number | null;

  @ApiPropertyOptional({
    description: 'Monthly rental allowance snapshot for this line (does not update User profile)',
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  rentalAllowanceMonthly?: number;

  @ApiPropertyOptional({
    description: 'Monthly commute allowance snapshot for this line',
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  commuteAllowanceMonthly?: number;

  @ApiPropertyOptional({
    enum: ConsultantPayModeDto,
    description: 'Consultant pay calculation mode',
  })
  @IsOptional()
  @IsEnum(ConsultantPayModeDto)
  consultantPayMode?: ConsultantPayModeDto | null;

  @ApiPropertyOptional({
    description: 'Override fixed monthly fee for FIXED-mode consultant (PKR)',
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  baseSalaryMonthly?: number;

  @ApiPropertyOptional({ description: 'Consultant contracted daily rate (PKR)' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  contractedDailyRate?: number | null;

  @ApiPropertyOptional({ description: 'Consultant contracted hourly rate (PKR)' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  contractedHourlyRate?: number | null;

  @ApiPropertyOptional({ description: 'Hours worked this month (consultant HOURLY_RATE mode)' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 1 })
  @Min(0)
  @Max(744)
  hoursWorked?: number | null;

  @ApiPropertyOptional({ description: 'Include this employee in the remittance bank export' })
  @IsOptional()
  @IsBoolean()
  payViaRemittance?: boolean;

  @ApiPropertyOptional({
    description: 'HR override for lunch deduction days (null = use standard working days)',
    example: 10,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(31)
  lunchDaysOverride?: number | null;
}
