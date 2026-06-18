import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateSalaryHoldDto {
  @ApiProperty({ description: 'Hold start date (ISO date)', example: '2026-06-01' })
  @IsDateString()
  startDate!: string;

  @ApiProperty({ description: 'Hold end date (ISO date)', example: '2026-08-31' })
  @IsDateString()
  endDate!: string;

  @ApiPropertyOptional({ description: 'Optional reason / notes' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}
