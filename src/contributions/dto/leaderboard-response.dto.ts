import { HttpStatus } from '@nestjs/common';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class LeaderboardUserDto {
  @ApiProperty({ description: 'User ID' })
  userId: string;

  @ApiProperty({ description: 'User display name' })
  name: string;

  @ApiProperty({ description: 'User email' })
  email: string;

  @ApiPropertyOptional({ description: 'User avatar URL' })
  avatarUrl: string | null;

  @ApiProperty({ description: 'Leaderboard rank (1-based)' })
  rank: number;

  @ApiProperty({ description: 'Primary score for this leaderboard category' })
  score: number;
}

// ─── Top Contributors ───────────────────────────────────────────────────────

export class TopContributorDto extends LeaderboardUserDto {
  @ApiProperty({ description: 'Total approved contributions' })
  approvedCount: number;

  @ApiProperty({ description: 'Total submitted contributions' })
  submittedCount: number;

  @ApiProperty({ description: 'Total contributions (all statuses)' })
  totalCount: number;

  @ApiProperty({ description: 'Tools / technologies used (unique list)' })
  topTechnologies: string[];
}

export class TopContributorsResponseDto {
  @ApiProperty({ type: [TopContributorDto] })
  data: TopContributorDto[];

  @ApiProperty({ description: 'Total number of entries' })
  total: number;
}

// ─── Top Reviewers ──────────────────────────────────────────────────────────

export class TopReviewerDto extends LeaderboardUserDto {
  @ApiProperty({ description: 'Total contributions reviewed (approved + rejected)' })
  reviewedCount: number;

  @ApiProperty({ description: 'Contributions approved by this reviewer' })
  approvedCount: number;

  @ApiProperty({ description: 'Contributions rejected by this reviewer' })
  rejectedCount: number;
}

export class TopReviewersResponseDto {
  @ApiProperty({ type: [TopReviewerDto] })
  data: TopReviewerDto[];

  @ApiProperty({ description: 'Total number of entries' })
  total: number;
}

// ─── Skill Expertise ────────────────────────────────────────────────────────

export class SkillExpertDto extends LeaderboardUserDto {
  @ApiProperty({ description: 'Number of distinct technologies used in approved contributions' })
  skillCount: number;

  @ApiProperty({ description: 'Top technologies used by this user' })
  topTechnologies: string[];

  @ApiProperty({ description: 'Approved contributions this expertise is based on' })
  approvedCount: number;
}

export class SkillExpertsResponseDto {
  @ApiProperty({ type: [SkillExpertDto] })
  data: SkillExpertDto[];

  @ApiProperty({ description: 'Total number of entries' })
  total: number;
}

// ─── Combined Leaderboard Response ──────────────────────────────────────────

export class LeaderboardDataDto {
  @ApiProperty({ description: 'Top contributors by approved contributions' })
  topContributors: TopContributorDto[];

  @ApiProperty({ description: 'Top reviewers by reviewed contributions' })
  topReviewers: TopReviewerDto[];

  @ApiProperty({ description: 'Skill experts by technology diversity' })
  skillExperts: SkillExpertDto[];
}

export class CombinedLeaderboardResponseDto {
  @ApiProperty({ description: 'Success message', required: false })
  message?: string;

  @ApiProperty({ type: LeaderboardDataDto, required: false })
  data?: LeaderboardDataDto;

  @ApiProperty({ description: 'HTTP status code' })
  statusCode?: HttpStatus;
}
