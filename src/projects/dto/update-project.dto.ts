import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsOptional,
  IsArray,
  IsEnum,
  IsDateString,
  IsUrl,
  IsEmail,
  IsBoolean,
  MinLength,
  MaxLength,
  ArrayMaxSize,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ConfidentialityLevel, ProjectStatus } from '@prisma/client';
import { SecurityProtocolsDto } from './security-protocols.dto';

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

  // =========================================================================
  // Project Hub — Narrative
  // =========================================================================

  @ApiPropertyOptional({ description: 'Executive summary (rich text HTML)' })
  @IsOptional()
  @IsString()
  executiveSummary?: string;

  @ApiPropertyOptional({
    description: 'Executive summary document URL (PDF/DOCX in Supabase)',
    nullable: true,
    maxLength: 2048,
  })
  @IsOptional()
  @ValidateIf((o) => o.executiveSummaryUrl !== null)
  @IsUrl({}, { message: 'executiveSummaryUrl must be a valid URL' })
  @MaxLength(2048)
  executiveSummaryUrl?: string | null;

  @ApiPropertyOptional({ description: 'Problem statement (rich text HTML)' })
  @IsOptional()
  @IsString()
  problemStatement?: string;

  @ApiPropertyOptional({
    description: 'Problem statement document URL (PDF/DOCX in Supabase)',
    nullable: true,
    maxLength: 2048,
  })
  @IsOptional()
  @ValidateIf((o) => o.problemStatementUrl !== null)
  @IsUrl({}, { message: 'problemStatementUrl must be a valid URL' })
  @MaxLength(2048)
  problemStatementUrl?: string | null;

  @ApiPropertyOptional({ description: 'High-level project deliverables', type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @MaxLength(500, { each: true })
  @ArrayMaxSize(100)
  deliverables?: string[];

  // =========================================================================
  // Project Hub — Lifecycle
  // =========================================================================

  @ApiPropertyOptional({ description: 'Project lifecycle status', enum: ProjectStatus })
  @IsOptional()
  @IsEnum(ProjectStatus)
  status?: ProjectStatus;

  // =========================================================================
  // Project Hub — Stakeholders
  // =========================================================================

  @ApiPropertyOptional({
    description: 'Project Manager user IDs (replaces all existing)',
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(20, { message: 'Maximum 20 project managers allowed' })
  projectManagerIds?: string[];

  @ApiPropertyOptional({
    description: 'Project Lead user IDs (replaces all existing)',
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(20, { message: 'Maximum 20 project leads allowed' })
  projectLeadIds?: string[];

  @ApiPropertyOptional({ description: 'Client contact name', maxLength: 255 })
  @IsOptional()
  @ValidateIf((o) => o.clientContactName !== null)
  @IsString()
  @MaxLength(255)
  clientContactName?: string | null;

  @ApiPropertyOptional({ description: 'Client contact email', maxLength: 320 })
  @IsOptional()
  @ValidateIf((o) => o.clientContactEmail !== null)
  @IsEmail({}, { message: 'clientContactEmail must be a valid email' })
  @MaxLength(320)
  clientContactEmail?: string | null;

  // =========================================================================
  // Project Hub — Security Protocols
  // =========================================================================

  @ApiPropertyOptional({
    description: 'Security protocols (null to clear)',
    nullable: true,
    type: SecurityProtocolsDto,
  })
  @IsOptional()
  @ValidateIf((o) => o.securityProtocols !== null)
  @ValidateNested()
  @Type(() => SecurityProtocolsDto)
  securityProtocols?: SecurityProtocolsDto | null;

  // =========================================================================
  // Project Hub — Resource Links
  // =========================================================================

  @ApiPropertyOptional({ description: 'Staging environment URL', nullable: true, maxLength: 2048 })
  @IsOptional()
  @ValidateIf((o) => o.stagingUrl !== null)
  @IsUrl({}, { message: 'stagingUrl must be a valid URL' })
  @MaxLength(2048)
  stagingUrl?: string | null;

  @ApiPropertyOptional({ description: 'Production/live URL', nullable: true, maxLength: 2048 })
  @IsOptional()
  @ValidateIf((o) => o.liveUrl !== null)
  @IsUrl({}, { message: 'liveUrl must be a valid URL' })
  @MaxLength(2048)
  liveUrl?: string | null;

  @ApiPropertyOptional({
    description: 'Documentation URL (GitHub/Notion)',
    nullable: true,
    maxLength: 2048,
  })
  @IsOptional()
  @ValidateIf((o) => o.documentationUrl !== null)
  @IsUrl({}, { message: 'documentationUrl must be a valid URL' })
  @MaxLength(2048)
  documentationUrl?: string | null;

  @ApiPropertyOptional({ description: 'Figma/design URL', nullable: true, maxLength: 2048 })
  @IsOptional()
  @ValidateIf((o) => o.figmaUrl !== null)
  @IsUrl({}, { message: 'figmaUrl must be a valid URL' })
  @MaxLength(2048)
  figmaUrl?: string | null;

  @ApiPropertyOptional({ description: 'GitHub repository URL', nullable: true, maxLength: 2048 })
  @IsOptional()
  @ValidateIf((o) => o.githubUrl !== null)
  @IsUrl({}, { message: 'githubUrl must be a valid URL' })
  @MaxLength(2048)
  githubUrl?: string | null;
}
