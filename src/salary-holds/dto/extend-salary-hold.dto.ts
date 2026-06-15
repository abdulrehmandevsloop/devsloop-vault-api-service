import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsOptional, IsString, MaxLength } from 'class-validator';

export class ExtendSalaryHoldDto {
  @ApiProperty({ description: 'New hold end date (ISO date)', example: '2026-10-31' })
  @IsDateString()
  endDate!: string;

  @ApiPropertyOptional({ description: 'Optionally adjust the start date too' })
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @ApiPropertyOptional({ description: 'Optional reason / notes' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}
