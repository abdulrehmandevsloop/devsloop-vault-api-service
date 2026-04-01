import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { MilestoneStatus, ClientSignOff } from '@prisma/client';
import { SprintResponseDto } from './sprint-response.dto';

export class MilestoneResponseDto {
  @ApiProperty() id: string;
  @ApiProperty() projectId: string;
  @ApiProperty() name: string;
  @ApiPropertyOptional({ nullable: true }) description: string | null;
  @ApiProperty() startDate: Date;
  @ApiPropertyOptional({ nullable: true }) endDate: Date | null;
  @ApiProperty({ enum: MilestoneStatus }) status: MilestoneStatus;
  @ApiProperty({ enum: ClientSignOff }) clientSignOff: ClientSignOff;
  @ApiProperty({ type: [String] }) deliverables: string[];
  @ApiProperty() order: number;
  @ApiProperty({ type: [SprintResponseDto] }) sprints: SprintResponseDto[];
  @ApiProperty({ description: 'Percentage of sprints with COMPLETED status (0–100)' })
  progressPercent: number;
  @ApiProperty() createdAt: Date;
  @ApiProperty() updatedAt: Date;
}
