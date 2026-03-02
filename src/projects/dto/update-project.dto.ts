import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsOptional,
  IsArray,
  IsEnum,
  IsDateString,
  IsUrl,
  MinLength,
  MaxLength,
  ArrayMaxSize,
} from 'class-validator';
import { ConfidentialityLevel } from '@prisma/client';

export class UpdateProjectDto {
  @ApiPropertyOptional({
    description: 'Project name',
    example: 'DevsLoop Platform v2',
    minLength: 3,
    maxLength: 255,
  })
  @IsOptional()
  @IsString({ message: 'Project name must be a string' })
  @MinLength(3, { message: 'Project name must be at least 3 characters' })
  @MaxLength(255, { message: 'Project name must not exceed 255 characters' })
  name?: string;

  @ApiPropertyOptional({
    description: 'Client name',
    example: 'Acme Corporation',
    maxLength: 255,
  })
  @IsOptional()
  @IsString({ message: 'Client name must be a string' })
  @MaxLength(255, { message: 'Client name must not exceed 255 characters' })
  clientName?: string;

  @ApiPropertyOptional({
    description: 'Domain or industry',
    example: 'E-commerce',
    maxLength: 255,
  })
  @IsOptional()
  @IsString({ message: 'Domain must be a string' })
  @MaxLength(255, { message: 'Domain must not exceed 255 characters' })
  domain?: string;

  @ApiPropertyOptional({
    description: 'Project description',
    example: 'A comprehensive knowledge management platform',
  })
  @IsOptional()
  @IsString({ message: 'Description must be a string' })
  @MaxLength(5000, { message: 'Description must not exceed 5000 characters' })
  description?: string;

  @ApiPropertyOptional({
    description: 'Project start date',
    example: '2024-01-01T00:00:00.000Z',
  })
  @IsOptional()
  @IsDateString({}, { message: 'Start date must be a valid ISO date string' })
  startDate?: string;

  @ApiPropertyOptional({
    description: 'Project end date',
    example: '2024-12-31T23:59:59.999Z',
  })
  @IsOptional()
  @IsDateString({}, { message: 'End date must be a valid ISO date string' })
  endDate?: string;

  @ApiPropertyOptional({
    description: 'Technology stack',
    example: ['NestJS', 'PostgreSQL', 'React', 'TypeScript'],
    type: [String],
  })
  @IsOptional()
  @IsArray({ message: 'Technology stack must be an array' })
  @IsString({ each: true, message: 'Each technology must be a string' })
  @ArrayMaxSize(50, { message: 'Maximum 50 technologies allowed' })
  @MaxLength(100, { each: true, message: 'Each technology must not exceed 100 characters' })
  techStack?: string[];

  @ApiPropertyOptional({
    description: 'Confidentiality level',
    enum: ConfidentialityLevel,
    example: ConfidentialityLevel.MEDIUM,
  })
  @IsOptional()
  @IsEnum(ConfidentialityLevel)
  confidentialityLevel?: ConfidentialityLevel;

  @ApiPropertyOptional({
    description: 'Google Chat webhook URL for worklog notifications',
    example: 'https://chat.googleapis.com/v1/spaces/AAAA/messages?key=...',
    maxLength: 2048,
  })
  @IsOptional()
  @IsUrl({}, { message: 'Channel URL must be a valid URL' })
  @MaxLength(2048)
  channelUrl?: string;
}
