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
import { MilestoneStatus, ClientSignOff } from '@prisma/client';

export class CreateMilestoneDto {
  @ApiProperty({ description: 'Milestone name', example: 'Phase 1 — Discovery', maxLength: 255 })
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  name: string;

  @ApiPropertyOptional({
    description: 'Milestone description (plain text or HTML)',
    example: 'Initial discovery and scoping phase',
  })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({ description: 'Start date (ISO 8601)', example: '2025-03-01T00:00:00.000Z' })
  @IsDateString({}, { message: 'startDate must be a valid ISO date string' })
  startDate: string;

  @ApiPropertyOptional({ description: 'End date (ISO 8601)', example: '2025-05-31T00:00:00.000Z' })
  @IsOptional()
  @IsDateString({}, { message: 'endDate must be a valid ISO date string' })
  endDate?: string;

  @ApiPropertyOptional({
    description: 'Milestone status',
    enum: MilestoneStatus,
    default: MilestoneStatus.PLANNED,
  })
  @IsOptional()
  @IsEnum(MilestoneStatus)
  status?: MilestoneStatus;

  @ApiPropertyOptional({
    description: 'Client sign-off status',
    enum: ClientSignOff,
    default: ClientSignOff.PENDING,
  })
  @IsOptional()
  @IsEnum(ClientSignOff)
  clientSignOff?: ClientSignOff;

  @ApiPropertyOptional({
    description: 'List of deliverables',
    type: [String],
    example: ['API Design', 'DB Schema'],
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
