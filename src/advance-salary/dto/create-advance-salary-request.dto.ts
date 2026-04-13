import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsNumber, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class CreateAdvanceSalaryRequestDto {
  @ApiProperty({ description: 'Advance salary amount requested in PKR', example: 30000 })
  @IsNumber()
  @Min(1)
  @Type(() => Number)
  amount: number;

  @ApiProperty({
    description: 'Reason for requesting advance salary',
    maxLength: 2000,
    example: 'Medical emergency',
  })
  @IsString()
  @MaxLength(2000)
  reason: string;

  @ApiProperty({
    description: 'Preferred number of months to repay (1–12)',
    example: 3,
    minimum: 1,
    maximum: 12,
  })
  @IsInt()
  @Min(1)
  @Max(12)
  @Type(() => Number)
  requestedRepaymentMonths: number;

  @ApiPropertyOptional({ description: 'Any additional notes', maxLength: 1000 })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}
