import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsNumber, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class DisburseAdvanceSalaryDto {
  @ApiProperty({
    description: 'Month to start repayment deductions (YYYY-MM)',
    example: '2026-05',
  })
  @IsString()
  @MaxLength(7)
  repaymentStartMonth: string;

  @ApiPropertyOptional({
    description:
      'Final approved amount, when adjusting at disbursement (defaults to the previously approved/requested amount). Only permitted at the HR (user entity) step.',
    minimum: 1,
  })
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Type(() => Number)
  approvedAmount?: number;

  @ApiPropertyOptional({
    description:
      'Final approved repayment months, when adjusting at disbursement (defaults to the previously approved/requested term). Only permitted at the HR (user entity) step.',
    minimum: 1,
    maximum: 36,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(36)
  @Type(() => Number)
  approvedRepaymentMonths?: number;

  @ApiPropertyOptional({
    description:
      'Reason for adjusting the amount or repayment term at disbursement. Persisted only when the values differ from what the employee requested.',
    maxLength: 2000,
  })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  modifyComment?: string;

  @ApiPropertyOptional({ description: 'Optional disbursement notes', maxLength: 1000 })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  disbursementNote?: string;
}
