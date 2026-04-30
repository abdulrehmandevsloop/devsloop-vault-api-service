import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsNumber, IsOptional, IsString, MaxLength, Min } from 'class-validator';
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

  @ApiPropertyOptional({ description: 'Review comment', maxLength: 2000 })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  reviewComment?: string;
}
