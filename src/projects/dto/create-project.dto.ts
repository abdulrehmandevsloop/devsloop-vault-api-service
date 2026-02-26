import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsOptional,
  IsArray,
  IsEnum,
  IsDateString,
  MinLength,
  MaxLength,
  IsNotEmpty,
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

  @ApiProperty({
    description: 'Domain or industry',
    example: 'E-commerce',
    maxLength: 255,
  })
  @IsNotEmpty({ message: 'Domain is required' })
  @IsString()
  @MaxLength(255, { message: 'Domain must not exceed 255 characters' })
  domain: string;

  @ApiProperty({
    description: 'Project description',
    example: 'A comprehensive knowledge management platform',
    maxLength: 2000,
  })
  @IsNotEmpty({ message: 'Description is required' })
  @IsString()
  @MaxLength(2000, { message: 'Description must not exceed 2000 characters' })
  description: string;

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

  @ApiProperty({
    description: 'Technology stack',
    example: ['NestJS', 'PostgreSQL', 'React', 'TypeScript'],
    type: [String],
  })
  @IsNotEmpty({ message: 'Technology stack is required' })
  @IsArray()
  @IsString({ each: true })
  techStack: string[];

  @ApiProperty({
    description: 'Confidentiality level',
    enum: ConfidentialityLevel,
    example: ConfidentialityLevel.MEDIUM,
    default: ConfidentialityLevel.MEDIUM,
  })
  @IsNotEmpty({ message: 'Confidentiality level is required' })
  @IsEnum(ConfidentialityLevel, {
    message: 'Confidentiality level must be one of: LOW, MEDIUM, HIGH',
  })
  confidentialityLevel: ConfidentialityLevel;
}
