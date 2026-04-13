import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString, Matches, Max, Min } from 'class-validator';

export class CreatePayrollPeriodDto {
  @ApiProperty({ description: 'Period in YYYY-MM', example: '2026-03' })
  @IsString()
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/, { message: 'yearMonth must be YYYY-MM' })
  yearMonth!: string;

  @ApiProperty({ description: 'Lunch deduction per working day', example: 200, required: false })
  @IsOptional()
  @Min(0)
  @Max(999999)
  lunchRatePerDay?: number;

  @ApiProperty({
    description: 'Default income tax percent applied to gross',
    example: 0,
    required: false,
  })
  @IsOptional()
  @Min(0)
  @Max(100)
  defaultTaxPercent?: number;
}
