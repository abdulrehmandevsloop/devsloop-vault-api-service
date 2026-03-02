import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsArray, IsString } from 'class-validator';

export class ReturnAssetDto {
  @ApiPropertyOptional({
    description:
      'User IDs whose assignments to return. When multiple assignees, required. When one assignee, optional (returns that one).',
    example: ['clxxx123', 'clxxx456'],
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  userIds?: string[];
}
