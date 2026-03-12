import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { WorklogStatus } from '@prisma/client';

class UserSummaryDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  name: string;

  @ApiProperty()
  email: string;

  @ApiPropertyOptional()
  avatarUrl: string | null;
}

class ProjectSummaryDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  name: string;

  @ApiProperty()
  clientName: string;
}

export class WorklogResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  userId: string;

  @ApiProperty()
  projectId: string;

  @ApiProperty({ description: 'Date in YYYY-MM-DD format' })
  date: string;

  @ApiProperty()
  content: string;

  @ApiProperty({ description: 'Whether this entry is a leave day', default: false })
  isLeave: boolean;

  @ApiPropertyOptional({ description: 'AI quality score 0–100', nullable: true })
  aiScore: number | null;

  @ApiPropertyOptional({ description: 'AI feedback message', nullable: true })
  aiFeedback: string | null;

  @ApiProperty({ enum: WorklogStatus })
  status: WorklogStatus;

  @ApiProperty({ description: 'Man-day count (always 1 per submission)', default: 1 })
  manDay: number;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;

  @ApiProperty({ type: UserSummaryDto })
  user: UserSummaryDto;

  @ApiProperty({ type: ProjectSummaryDto })
  project: ProjectSummaryDto;
}
