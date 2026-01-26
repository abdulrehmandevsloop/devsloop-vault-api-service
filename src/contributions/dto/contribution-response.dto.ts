import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ContributionStatus, VisibilityLevel } from '@prisma/client';

class UserSummaryDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  name: string;

  @ApiProperty()
  email: string;
}

class ProjectSummaryDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  name: string;

  @ApiPropertyOptional()
  clientName: string | null;
}

class TagDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  name: string;

  @ApiProperty()
  category: string;
}

export class ContributionResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  roleInProject: string;

  @ApiProperty()
  task: string;

  @ApiProperty({ description: 'Solution/action taken (may contain HTML)' })
  action: string;

  @ApiProperty({ type: [String] })
  toolsTechnologies: string[];

  @ApiPropertyOptional({ description: 'Outcome/impact (may contain HTML)' })
  outcome: string | null;

  @ApiPropertyOptional({ description: 'Key learnings (may contain HTML)' })
  keyLearnings: string | null;

  @ApiProperty({ type: [String] })
  attachments: string[];

  @ApiProperty({ enum: VisibilityLevel })
  visibilityLevel: VisibilityLevel;

  @ApiProperty({ enum: ContributionStatus })
  status: ContributionStatus;

  @ApiPropertyOptional()
  submittedAt: Date | null;

  @ApiPropertyOptional()
  reviewedAt: Date | null;

  @ApiPropertyOptional()
  reviewComments: string | null;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;

  @ApiProperty({ type: UserSummaryDto })
  user: UserSummaryDto;

  @ApiProperty({ type: ProjectSummaryDto })
  project: ProjectSummaryDto;

  @ApiPropertyOptional({ type: UserSummaryDto })
  reviewer: UserSummaryDto | null;

  @ApiProperty({ type: [TagDto] })
  tags: { tag: TagDto }[];
}

export class PaginatedContributionsResponseDto {
  @ApiProperty({ type: [ContributionResponseDto] })
  data: ContributionResponseDto[];

  @ApiProperty()
  total: number;

  @ApiProperty()
  page: number;

  @ApiProperty()
  limit: number;

  @ApiProperty()
  totalPages: number;

  @ApiProperty()
  hasNextPage: boolean;

  @ApiProperty()
  hasPreviousPage: boolean;
}
