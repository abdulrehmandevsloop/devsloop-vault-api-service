import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsNumber, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class ApproveAdvanceSalaryDto {
  @ApiPropertyOptional({
    description: 'Approved amount (defaults to requested if omitted)',
    minimum: 1,
  })
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Type(() => Number)
  approvedAmount?: number;

  @ApiPropertyOptional({
    description: 'Approved repayment months (defaults to requested if omitted)',
    minimum: 1,
    maximum: 12,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(12)
  @Type(() => Number)
  approvedRepaymentMonths?: number;

  @ApiPropertyOptional({ description: 'Review comment', maxLength: 2000 })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  reviewComment?: string;
}
