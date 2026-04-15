import { IsString, IsNumber, IsOptional, IsInt, Min, Max, MaxLength } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateLoanRequestDto {
  @ApiProperty({ description: 'Loan amount requested in PKR', example: 50000 })
  @IsNumber()
  @Min(1)
  @Type(() => Number)
  amount: number;

  @ApiProperty({
    description: 'Purpose / reason for the loan',
    maxLength: 2000,
    example: 'Medical emergency for family member',
  })
  @IsString()
  @MaxLength(2000)
  purpose: string;

  @ApiProperty({
    description: 'Preferred number of months to repay the loan (1–36)',
    example: 6,
    minimum: 1,
    maximum: 36,
  })
  @IsInt()
  @Min(1)
  @Max(36)
  @Type(() => Number)
  requestedRepaymentMonths: number;

  @ApiPropertyOptional({
    description: 'Any additional notes or context',
    maxLength: 1000,
  })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}
