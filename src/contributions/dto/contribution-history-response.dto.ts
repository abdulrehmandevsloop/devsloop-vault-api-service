import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export enum ContributionHistoryAction {
  CREATED = 'CREATED',
  UPDATED = 'UPDATED',
  SUBMITTED = 'SUBMITTED',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
  REVERTED_TO_DRAFT = 'REVERTED_TO_DRAFT',
  DELETED = 'DELETED',
  OTHER = 'OTHER',
}

export class ContributionHistoryActorDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  name: string;

  @ApiProperty()
  email: string;

  @ApiPropertyOptional()
  avatarUrl?: string | null;
}

export class ContributionHistoryEntryDto {
  @ApiProperty({ enum: ContributionHistoryAction })
  action: ContributionHistoryAction;

  @ApiProperty({ description: 'When the action occurred' })
  at: Date;

  @ApiPropertyOptional({ type: ContributionHistoryActorDto, nullable: true })
  by: ContributionHistoryActorDto | null;

  @ApiPropertyOptional({
    description: 'Action-specific metadata (e.g., reviewerComment, changedFields)',
    type: Object,
  })
  metadata?: Record<string, unknown> | null;
}

export class ContributionHistoryResponseDto {
  @ApiProperty()
  contributionId: string;

  @ApiProperty({ type: [ContributionHistoryEntryDto] })
  items: ContributionHistoryEntryDto[];
}
