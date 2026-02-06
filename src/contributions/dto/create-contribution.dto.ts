import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ArrayMaxSize,
} from 'class-validator';
import { VisibilityLevel } from '@prisma/client';

export class CreateContributionDto {
  @ApiProperty({
    description: 'Project ID this contribution belongs to (CUID format)',
    example: 'clx1234567890abcdefghijkl',
  })
  @IsNotEmpty({ message: 'Project ID is required' })
  @IsString()
  projectId: string;

  @ApiProperty({
    description: 'Problem statement or challenge addressed (as long as needed)',
    example: 'Users were experiencing slow page load times due to inefficient database queries',
    minLength: 10,
    maxLength: 5000,
  })
  @IsNotEmpty()
  @IsString()
  @MinLength(10, { message: 'Problem description must be at least 10 characters' })
  @MaxLength(5000, { message: 'Problem description must be at most 5000 characters' })
  problem: string;

  @ApiProperty({
    description:
      'Solution implemented to address the problem (supports rich text/HTML). Must be at least 50 characters.',
    example: '<p>Implemented query optimization with proper indexing and caching layer...</p>',
    minLength: 50,
  })
  @IsNotEmpty()
  @IsString()
  @MinLength(50, { message: 'Solution description must be at least 50 characters' })
  solution: string;

  @ApiPropertyOptional({
    description: 'Outcome or impact of your contribution (supports rich text/HTML)',
    example: '<p>Reduced page load time by 60% and improved user satisfaction...</p>',
  })
  @IsOptional()
  @IsString({ message: 'Outcome must be a string' })
  @MaxLength(10000, { message: 'Outcome must not exceed 10000 characters' })
  outcome?: string;

  @ApiPropertyOptional({
    description: 'Key learnings from this experience (supports rich text/HTML)',
    example:
      '<p>Learned about query optimization, indexing strategies, and caching patterns...</p>',
  })
  @IsOptional()
  @IsString({ message: 'Learnings must be a string' })
  @MaxLength(10000, { message: 'Learnings must not exceed 10000 characters' })
  learnings?: string;

  @ApiPropertyOptional({
    description: 'Tools and technologies used',
    example: ['React', 'TypeScript', 'PostgreSQL', 'Redis'],
    type: [String],
  })
  @IsOptional()
  @IsArray({ message: 'Tools and technologies must be an array' })
  @IsString({ each: true, message: 'Each tool/technology must be a string' })
  @ArrayMaxSize(50, { message: 'Maximum 50 tools/technologies allowed' })
  @MaxLength(100, { each: true, message: 'Each tool/technology must not exceed 100 characters' })
  toolsAndTechnologies?: string[];

  @ApiPropertyOptional({
    description: 'Visibility level of the contribution',
    enum: VisibilityLevel,
    default: 'PRIVATE',
  })
  @IsOptional()
  @IsEnum(VisibilityLevel)
  visibility?: VisibilityLevel;
}
