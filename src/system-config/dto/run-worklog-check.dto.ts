import { IsOptional, IsString, Matches } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class RunWorklogCheckDto {
  @ApiPropertyOptional({
    description: 'Month to check in YYYY-MM format. Defaults to the current month.',
    example: '2026-02',
  })
  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/, { message: 'month must be in YYYY-MM format' })
  month?: string;
}
