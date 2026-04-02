import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsInt, IsNumber, IsOptional, Max, MaxLength, Min } from 'class-validator';

export class UpdatePayrollLineDto {
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
  deductionTaxable?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  deductionNonTaxable?: number;

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

  @ApiPropertyOptional({ description: 'Override period default tax percent for this line' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100)
  taxPercentOverride?: number | null;

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
}
