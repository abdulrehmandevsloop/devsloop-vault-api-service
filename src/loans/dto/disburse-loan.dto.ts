import { IsString, MaxLength, IsDateString, IsOptional } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class DisburseLoanDto {
  @ApiProperty({
    description: 'Month to start repayment deductions (YYYY-MM format)',
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
