import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsOptional,
  IsArray,
  IsEnum,
  IsDateString,
  IsUrl,
  IsNotEmpty,
  MinLength,
  MaxLength,
} from 'class-validator';
import { ConfidentialityLevel } from '@prisma/client';

export class CreateProjectDto {
  @ApiProperty({
    description: 'Project name',
    example: 'DevsLoop Platform v2',
    minLength: 3,
    maxLength: 255,
  })
  @IsNotEmpty({ message: 'Project name is required' })
  @IsString()
  @MinLength(3, { message: 'Project name must be at least 3 characters' })
  @MaxLength(255, { message: 'Project name must not exceed 255 characters' })
  name: string;

  @ApiProperty({
    description: 'Client name',
    example: 'Acme Corporation',
    maxLength: 255,
  })
  @IsNotEmpty({ message: 'Client name is required' })
  @IsString()
  @MaxLength(255, { message: 'Client name must not exceed 255 characters' })
  clientName: string;

  @ApiPropertyOptional({
    description: 'Domain or industry',
    example: 'E-commerce',
    maxLength: 255,
  })
  @IsOptional()
  @IsString()
  @MaxLength(255, { message: 'Domain must not exceed 255 characters' })
  domain?: string;

  @ApiPropertyOptional({
    description: 'Project description',
    example: 'A comprehensive knowledge management platform',
    maxLength: 2000,
  })
  @IsOptional()
  @IsString()
  @MaxLength(2000, { message: 'Description must not exceed 2000 characters' })
  description?: string;

  @ApiProperty({
    description: 'Project start date',
    example: '2024-01-01T00:00:00.000Z',
  })
  @IsNotEmpty({ message: 'Start date is required' })
  @IsDateString({}, { message: 'Start date must be a valid ISO date string' })
  startDate: string;

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
  @IsArray()
  @IsString({ each: true })
  techStack?: string[];

  @ApiPropertyOptional({
    description: 'Confidentiality level',
    enum: ConfidentialityLevel,
    example: ConfidentialityLevel.MEDIUM,
    default: ConfidentialityLevel.MEDIUM,
  })
  @IsOptional()
  @IsEnum(ConfidentialityLevel, {
    message: 'Confidentiality level must be one of: LOW, MEDIUM, HIGH',
  })
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
