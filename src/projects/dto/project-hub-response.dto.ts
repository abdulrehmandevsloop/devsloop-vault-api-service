import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ConfidentialityLevel, ProjectStatus } from '@prisma/client';
import { MilestoneResponseDto } from './milestone-response.dto';

export class HubStakeholderDto {
  @ApiProperty() id: string;
  @ApiProperty() name: string;
  @ApiProperty() email: string;
  @ApiPropertyOptional({ nullable: true }) avatarUrl: string | null;
}

export class HubTeamMemberDto {
  @ApiProperty() id: string;
  @ApiProperty() name: string;
  @ApiProperty() email: string;
  @ApiPropertyOptional({ nullable: true }) avatarUrl: string | null;
  @ApiProperty({ type: [String] }) roles: string[];
  @ApiProperty() assignedAt: Date;
}

export class ProjectHubResponseDto {
  // Core project fields
  @ApiProperty() id: string;
  @ApiProperty() name: string;
  @ApiProperty() clientName: string;
  @ApiProperty() domain: string;
  @ApiProperty() description: string;
  @ApiProperty() startDate: Date;
  @ApiPropertyOptional({ nullable: true }) endDate: Date | null;
  @ApiProperty({ type: [String] }) techStack: string[];
  @ApiProperty({ enum: ConfidentialityLevel }) confidentialityLevel: ConfidentialityLevel;
  @ApiPropertyOptional({ nullable: true }) channelUrl: string | null;

  // Hub — Narrative
  @ApiPropertyOptional({ nullable: true }) executiveSummary: string | null;
  @ApiPropertyOptional({ nullable: true }) executiveSummaryUrl: string | null;
  @ApiPropertyOptional({ nullable: true }) problemStatement: string | null;
  @ApiPropertyOptional({ nullable: true }) problemStatementUrl: string | null;
  @ApiProperty({ type: [String] }) deliverables: string[];

  // Hub — Lifecycle
  @ApiProperty({ enum: ProjectStatus }) status: ProjectStatus;

  // Hub — Stakeholders
  @ApiPropertyOptional({ nullable: true, type: HubStakeholderDto })
  projectManager: HubStakeholderDto | null;
  @ApiPropertyOptional({ nullable: true, type: HubStakeholderDto })
  projectLead: HubStakeholderDto | null;
  @ApiPropertyOptional({ nullable: true }) clientContactName: string | null;
  @ApiPropertyOptional({ nullable: true }) clientContactEmail: string | null;

  // Hub — Security
  @ApiPropertyOptional({ nullable: true }) securityProtocols: Record<string, unknown> | null;

  // Hub — Resource Links
  @ApiPropertyOptional({ nullable: true }) stagingUrl: string | null;
  @ApiPropertyOptional({ nullable: true }) liveUrl: string | null;
  @ApiPropertyOptional({ nullable: true }) documentationUrl: string | null;
  @ApiPropertyOptional({ nullable: true }) figmaUrl: string | null;
  @ApiPropertyOptional({ nullable: true }) githubUrl: string | null;

  // Hub — Roadmap
  @ApiProperty({ type: [MilestoneResponseDto] }) milestones: MilestoneResponseDto[];
  @ApiProperty({ description: 'Percentage of milestones with COMPLETED status (0–100)' })
  milestoneProgressPercent: number;

  // Hub — Team
  @ApiProperty({ type: [HubTeamMemberDto] }) teamMembers: HubTeamMemberDto[];

  // Timestamps
  @ApiProperty() createdAt: Date;
  @ApiProperty() updatedAt: Date;
}
