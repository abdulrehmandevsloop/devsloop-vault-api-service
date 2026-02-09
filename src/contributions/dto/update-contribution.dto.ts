import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ArrayMaxSize,
  ArrayMinSize,
} from 'class-validator';
import { VisibilityLevel } from '@prisma/client';
import { PlainTextMinLength, PlainTextMaxLength } from '../../common';

export class UpdateContributionDto {
  @ApiPropertyOptional({
    description: 'Project ID this contribution belongs to (CUID format)',
    example: 'clx1234567890abcdefghijkl',
  })
  @IsOptional()
  @IsString({ message: 'Project ID must be a string' })
  @MaxLength(100, { message: 'Project ID must not exceed 100 characters' })
  projectId?: string;

  @ApiPropertyOptional({
    description: 'Problem statement or challenge addressed (plain text, max 5000)',
    example: 'Users were experiencing slow page load times due to inefficient database queries',
    minLength: 10,
    maxLength: 5000,
  })
  @IsOptional()
  @IsString()
  @MinLength(10, { message: 'Problem description must be at least 10 characters' })
  @MaxLength(5000, { message: 'Problem description must be less than 5000 characters' })
  problem?: string;

  @ApiPropertyOptional({
    description:
      'Solution implemented to address the problem (supports rich text/HTML). Plain text length must be between 50 and 10,000 characters.',
    example: '<p>Implemented query optimization with proper indexing and caching layer...</p>',
  })
  @IsOptional()
  @IsString()
  @PlainTextMinLength(50, { message: 'Solution must be at least 50 characters' })
  @PlainTextMaxLength(10000, { message: 'Solution must be less than 10,000 characters' })
  solution?: string;

  @ApiPropertyOptional({
    description:
      'Outcome or impact of your contribution (supports rich text/HTML). Plain text length must be between 20 and 5,000 characters.',
    example: '<p>Reduced page load time by 60% and improved user satisfaction...</p>',
  })
  @IsOptional()
  @IsString({ message: 'Outcome must be a string' })
  @PlainTextMinLength(20, { message: 'Outcome must be at least 20 characters' })
  @PlainTextMaxLength(5000, { message: 'Outcome must be less than 5,000 characters' })
  outcome?: string;

  @ApiPropertyOptional({
    description:
      'Key learnings from this experience (supports rich text/HTML). Plain text length must be between 20 and 5,000 characters.',
    example:
      '<p>Learned about query optimization, indexing strategies, and caching patterns...</p>',
  })
  @IsOptional()
  @IsString({ message: 'Learnings must be a string' })
  @PlainTextMinLength(20, { message: 'Learnings must be at least 20 characters' })
  @PlainTextMaxLength(5000, { message: 'Learnings must be less than 5,000 characters' })
  learnings?: string;

  @ApiPropertyOptional({
    description: 'Tools and technologies used (at least one required when provided)',
    example: ['React', 'TypeScript', 'PostgreSQL', 'Redis'],
    type: [String],
  })
  @IsOptional()
  @IsArray({ message: 'Tools and technologies must be an array' })
  @ArrayMinSize(1, { message: 'At least one tool or technology is required' })
  @IsString({ each: true, message: 'Each tool/technology must be a string' })
  @ArrayMaxSize(50, { message: 'Maximum 50 tools/technologies allowed' })
  @MaxLength(100, { each: true, message: 'Each tool/technology must not exceed 100 characters' })
  toolsAndTechnologies?: string[];

  @ApiPropertyOptional({
    description: 'Visibility level of the contribution',
    enum: VisibilityLevel,
  })
  @IsOptional()
  @IsEnum(VisibilityLevel)
  visibility?: VisibilityLevel;
}
