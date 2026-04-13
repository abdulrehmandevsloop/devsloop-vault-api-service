import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class DisburseAdvanceSalaryDto {
  @ApiProperty({
    description: 'Month to start repayment deductions (YYYY-MM)',
    example: '2026-05',
  })
  @IsString()
  @MaxLength(7)
  repaymentStartMonth: string;

  @ApiPropertyOptional({ description: 'Optional disbursement notes', maxLength: 1000 })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  disbursementNote?: string;
}
