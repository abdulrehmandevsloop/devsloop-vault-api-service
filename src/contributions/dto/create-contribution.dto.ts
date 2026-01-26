import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
  MinLength,
} from 'class-validator';
import { VisibilityLevel } from '@prisma/client';

export class CreateContributionDto {
  @ApiProperty({
    description: 'Project ID this contribution belongs to',
    example: 'clx1234567890',
  })
  @IsNotEmpty()
  @IsString()
  projectId: string;

  @ApiProperty({
    description: 'Your role in the project',
    example: 'Frontend Developer',
  })
  @IsNotEmpty()
  @IsString()
  roleInProject: string;

  @ApiProperty({
    description: 'Problem or task you worked on',
    example: 'Implement user authentication with OAuth2',
    minLength: 10,
  })
  @IsNotEmpty()
  @IsString()
  @MinLength(10, { message: 'Task description must be at least 10 characters' })
  task: string;

  @ApiProperty({
    description: 'Solution or action taken (supports rich text/HTML)',
    example:
      '<p>Implemented OAuth2 authentication using NextAuth.js with Google and GitHub providers...</p>',
    minLength: 50,
  })
  @IsNotEmpty()
  @IsString()
  @MinLength(50, { message: 'Action description must be at least 50 characters' })
  action: string;

  @ApiPropertyOptional({
    description: 'Tools and technologies used',
    example: ['React', 'TypeScript', 'NextAuth.js', 'PostgreSQL'],
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  toolsTechnologies?: string[];

  @ApiPropertyOptional({
    description: 'Outcome or impact of your contribution (supports rich text/HTML)',
    example: '<p>Reduced authentication setup time by 60% and improved security...</p>',
  })
  @IsOptional()
  @IsString()
  outcome?: string;

  @ApiPropertyOptional({
    description: 'Key learnings from this experience (supports rich text/HTML)',
    example:
      '<p>Learned about OAuth2 flows, token refresh strategies, and session management...</p>',
  })
  @IsOptional()
  @IsString()
  keyLearnings?: string;

  @ApiPropertyOptional({
    description: 'URLs to attachments (images, documents, etc.)',
    example: ['https://example.com/diagram.png', 'https://example.com/doc.pdf'],
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @IsUrl({}, { each: true, message: 'Each attachment must be a valid URL' })
  attachments?: string[];

  @ApiPropertyOptional({
    description: 'Visibility level of the contribution',
    enum: VisibilityLevel,
    default: 'PRIVATE',
  })
  @IsOptional()
  @IsEnum(VisibilityLevel)
  visibilityLevel?: VisibilityLevel;

  @ApiPropertyOptional({
    description: 'Tag IDs to associate with this contribution',
    example: ['tag-id-1', 'tag-id-2'],
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tagIds?: string[];
}
