import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsEnum, IsNumber, IsOptional, Max, Min } from 'class-validator';

enum ConsultantPayModeDto {
  FIXED = 'FIXED',
  DAILY_RATE = 'DAILY_RATE',
  HOURLY_RATE = 'HOURLY_RATE',
}

export class UpsertPayrollProfileDto {
  @ApiPropertyOptional({ example: 500 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(9999999999.99)
  rentalAllowanceMonthly?: number;

  @ApiPropertyOptional({ example: 200 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(9999999999.99)
  commuteAllowanceMonthly?: number;

  @ApiPropertyOptional({
    enum: ConsultantPayModeDto,
    description: 'Default pay mode for consultant (FIXED/DAILY_RATE/HOURLY_RATE)',
  })
  @IsOptional()
  @IsEnum(ConsultantPayModeDto)
  defaultConsultantPayMode?: ConsultantPayModeDto;

  @ApiPropertyOptional({ description: 'Default contracted daily rate (PKR) for DAILY_RATE mode' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  defaultDailyRate?: number;

  @ApiPropertyOptional({ description: 'Default contracted hourly rate (PKR) for HOURLY_RATE mode' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  defaultHourlyRate?: number;

  @ApiPropertyOptional({ description: 'Pay this employee via remittance bank transfer by default' })
  @IsOptional()
  @IsBoolean()
  payViaRemittance?: boolean;
}
