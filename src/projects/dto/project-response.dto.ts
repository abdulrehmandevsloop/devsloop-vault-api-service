import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ConfidentialityLevel } from '@prisma/client';

export class ProjectResponseDto {
  @ApiProperty({
    description: 'Project ID',
    example: 'clx1234567890',
  })
  id: string;

  @ApiProperty({
    description: 'Project name',
    example: 'DevsLoop Platform v2',
  })
  name: string;

  @ApiProperty({
    description: 'Client name',
    example: 'Acme Corporation',
  })
  clientName: string;

  @ApiProperty({
    description: 'Domain or industry',
    example: 'E-commerce',
  })
  domain: string;

  @ApiProperty({
    description: 'Project description',
    example: 'A comprehensive knowledge management platform',
  })
  description: string;

  @ApiProperty({
    description: 'Project start date',
    example: '2024-01-01T00:00:00.000Z',
  })
  startDate: Date;

  @ApiPropertyOptional({
    description: 'Project end date',
    example: '2024-12-31T23:59:59.999Z',
  })
  endDate?: Date | null;

  @ApiProperty({
    description: 'Technology stack',
    example: ['NestJS', 'PostgreSQL', 'React', 'TypeScript'],
    type: [String],
  })
  techStack: string[];

  @ApiProperty({
    description: 'Confidentiality level',
    enum: ConfidentialityLevel,
    example: ConfidentialityLevel.MEDIUM,
  })
  confidentialityLevel: ConfidentialityLevel;

  @ApiProperty({
    description: 'Creation timestamp',
    example: '2024-01-15T10:00:00.000Z',
  })
  createdAt: Date;

  @ApiProperty({
    description: 'Last update timestamp',
    example: '2024-01-20T15:30:00.000Z',
  })
  updatedAt: Date;

  @ApiProperty({
    description: 'Number of users assigned to this project',
    example: 5,
  })
  assignedUserCount: number;

  @ApiPropertyOptional({
    description: 'Project Manager names (list endpoint only)',
    type: [String],
  })
  projectManagerNames?: string[];

  @ApiPropertyOptional({
    description: 'Project Lead names (list endpoint only)',
    type: [String],
  })
  projectLeadNames?: string[];

  @ApiPropertyOptional({
    description: 'Total milestones attached to this project',
    example: 4,
  })
  milestoneCount?: number;

  @ApiPropertyOptional({
    description: 'Total sprints across all milestones for this project',
    example: 12,
  })
  sprintCount?: number;

  @ApiPropertyOptional({
    description: 'Project roadmap progress percentage (0-100), based on active milestones/sprints',
    example: 67,
  })
  milestoneProgressPercent?: number;

  @ApiPropertyOptional({
    description: 'Google Chat webhook URL for worklog notifications',
    nullable: true,
  })
  channelUrl?: string | null;

  @ApiPropertyOptional({ nullable: true })
  status?: string;

  @ApiPropertyOptional({ nullable: true })
  clientContactName?: string | null;

  @ApiPropertyOptional({ nullable: true })
  clientContactEmail?: string | null;

  @ApiPropertyOptional({ nullable: true })
  executiveSummary?: string | null;

  @ApiPropertyOptional({ nullable: true })
  executiveSummaryUrl?: string | null;

  @ApiPropertyOptional({ nullable: true })
  problemStatement?: string | null;

  @ApiPropertyOptional({ nullable: true })
  problemStatementUrl?: string | null;

  @ApiPropertyOptional({ type: [String] })
  deliverables?: string[];

  @ApiPropertyOptional({ nullable: true })
  securityProtocols?: Record<string, unknown> | null;

  @ApiPropertyOptional({ nullable: true })
  stagingUrl?: string | null;

  @ApiPropertyOptional({ nullable: true })
  liveUrl?: string | null;

  @ApiPropertyOptional({ nullable: true })
  documentationUrl?: string | null;

  @ApiPropertyOptional({ nullable: true })
  figmaUrl?: string | null;

  @ApiPropertyOptional({ nullable: true })
  githubUrl?: string | null;
}
