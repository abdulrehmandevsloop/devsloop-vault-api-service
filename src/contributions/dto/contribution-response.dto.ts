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

export class ContributionResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty({ description: 'Problem statement or challenge addressed' })
  problem: string;

  @ApiProperty({ description: 'Solution implemented (may contain HTML)' })
  solution: string;

  @ApiProperty({ description: 'Outcome/impact (may contain HTML)' })
  outcome: string;

  @ApiProperty({ description: 'Key learnings (may contain HTML)' })
  learnings: string;

  @ApiProperty({ type: [String] })
  toolsAndTechnologies: string[];

  @ApiProperty({ enum: VisibilityLevel })
  visibility: VisibilityLevel;

  @ApiProperty({ enum: ContributionStatus })
  status: ContributionStatus;

  @ApiPropertyOptional({
    description:
      'Reviewer comment (rejection reason when status is REJECTED). Contributors can retrieve this via GET /contributions/:id or GET /contributions/my.',
  })
  reviewerComment: string | null;

  @ApiPropertyOptional({
    description: 'When the contribution was approved or rejected by a reviewer',
  })
  reviewedAt: Date | null;

  @ApiProperty({
    description: 'Number of times this contribution has been rejected by reviewers',
    example: 0,
  })
  rejectionCount: number;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;

  @ApiProperty({ type: UserSummaryDto })
  author: UserSummaryDto;

  @ApiProperty({ type: ProjectSummaryDto })
  project: ProjectSummaryDto;

  @ApiPropertyOptional({ type: UserSummaryDto })
  reviewer: UserSummaryDto | null;
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
