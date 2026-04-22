import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsString,
  ArrayUnique,
  ArrayMaxSize,
  IsEnum,
  IsOptional,
  ValidateNested,
} from 'class-validator';
import { EngagementType } from '@prisma/client';

export class UserEngagementItemDto {
  @ApiProperty({ description: 'User ID (CUID)', example: 'clx1234567890' })
  @IsString()
  userId: string;

  @ApiPropertyOptional({
    description: 'Engagement type for this user on the project. Defaults to FULL_TIME.',
    enum: EngagementType,
    example: EngagementType.FULL_TIME,
  })
  @IsOptional()
  @IsEnum(EngagementType)
  engagementType?: EngagementType;
}

export class AssignUsersToProjectDto {
  /**
   * Legacy format: flat array of user IDs. All get FULL_TIME engagement.
   * Kept for backward-compatibility with existing clients.
   * Prefer `users` for new callers.
   */
  @ApiPropertyOptional({
    description:
      'Legacy: array of user IDs. All assigned as FULL_TIME. Use `users` for per-user engagement control.',
    example: ['clx1234567890'],
    type: [String],
    deprecated: true,
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @ArrayUnique()
  @ArrayMaxSize(500, { message: 'Cannot assign more than 500 users at once' })
  userIds?: string[];

  /**
   * New format: per-user engagement type. Takes precedence over `userIds` when both are sent.
   */
  @ApiPropertyOptional({
    description:
      'List of users with per-user engagement type. Replaces all existing assignments. Empty array removes all. Max 500.',
    type: [UserEngagementItemDto],
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => UserEngagementItemDto)
  @ArrayUnique<UserEngagementItemDto>((item) => item.userId)
  @ArrayMaxSize(500, { message: 'Cannot assign more than 500 users at once' })
  users?: UserEngagementItemDto[];
}
