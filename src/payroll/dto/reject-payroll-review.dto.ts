import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class RejectPayrollReviewDto {
  @ApiPropertyOptional({
    description: 'Optional note to the submitter explaining what to fix',
    maxLength: 2000,
    example: 'Please recalculate after updating lunch settings.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  comment?: string;
}
