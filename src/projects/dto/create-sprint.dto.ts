import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsOptional,
  IsArray,
  IsEnum,
  IsDateString,
  IsInt,
  MinLength,
  MaxLength,
  Min,
} from 'class-validator';
import { SprintStatus } from '@prisma/client';

export class CreateSprintDto {
  @ApiProperty({
    description: 'Sprint name',
    example: 'Sprint 1 — Auth & Core APIs',
    maxLength: 255,
  })
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  name: string;

  @ApiPropertyOptional({
    description: 'Sprint description',
    example: 'Implement authentication and core API endpoints',
  })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({ description: 'Start date (ISO 8601)', example: '2025-03-01T00:00:00.000Z' })
  @IsDateString({}, { message: 'startDate must be a valid ISO date string' })
  startDate: string;

  @ApiPropertyOptional({ description: 'End date (ISO 8601)', example: '2025-03-15T00:00:00.000Z' })
  @IsOptional()
  @IsDateString({}, { message: 'endDate must be a valid ISO date string' })
  endDate?: string;

  @ApiPropertyOptional({
    description: 'Sprint status',
    enum: SprintStatus,
    default: SprintStatus.PLANNED,
  })
  @IsOptional()
  @IsEnum(SprintStatus)
  status?: SprintStatus;

  @ApiPropertyOptional({
    description: 'List of deliverables for this sprint',
    type: [String],
    example: ['JWT auth', 'User CRUD'],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @MaxLength(500, { each: true })
  deliverables?: string[];

  @ApiPropertyOptional({ description: 'Display order (0-based)', example: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  order?: number;
}
