import { IsNumber, IsOptional, IsInt, Min, Max, IsString, MaxLength } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class ApproveLoanDto {
  @ApiPropertyOptional({
    description: 'Approved loan amount (defaults to requested amount if not specified)',
    minimum: 1,
  })
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Type(() => Number)
  approvedAmount?: number;

  @ApiPropertyOptional({
    description: 'Approved repayment months (defaults to requested months if not specified)',
    minimum: 1,
    maximum: 36,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(36)
  @Type(() => Number)
  approvedRepaymentMonths?: number;

  @ApiPropertyOptional({ description: 'Review comment', maxLength: 2000 })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  reviewComment?: string;

  @ApiPropertyOptional({
    description:
      'HR comment explaining why the requested amount or repayment term was modified. Persisted only when the approved values differ from what the employee requested.',
    maxLength: 2000,
  })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  modifyComment?: string;
}
