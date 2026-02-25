import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { VisibilityLevel } from '@prisma/client';

class VaultAuthorDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  name: string;

  @ApiProperty()
  email: string;
}

class VaultProjectSummaryDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  name: string;

  @ApiPropertyOptional()
  clientName: string | null;
}

export class VaultContributionDto {
  @ApiProperty()
  id: string;

  @ApiProperty({ description: 'Problem statement' })
  problem: string;

  @ApiProperty({ description: 'Solution (HTML)' })
  solution: string;

  @ApiPropertyOptional({ description: 'Outcome (HTML)' })
  outcome: string | null;

  @ApiPropertyOptional({ description: 'Learnings (HTML)' })
  learnings: string | null;

  @ApiProperty({ type: [String] })
  toolsAndTechnologies: string[];

  @ApiProperty({ enum: VisibilityLevel })
  visibility: VisibilityLevel;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;

  @ApiProperty({ type: VaultAuthorDto })
  author: VaultAuthorDto;

  @ApiProperty({ type: VaultProjectSummaryDto })
  project: VaultProjectSummaryDto;
}

export class VaultContributionsResponseDto {
  @ApiProperty({ type: [VaultContributionDto] })
  data: VaultContributionDto[];

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
