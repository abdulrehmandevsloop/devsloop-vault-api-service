import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsOptional, IsBoolean, IsArray, MaxLength, ArrayMaxSize } from 'class-validator';

export class UpdateRoleDto {
  @ApiPropertyOptional({
    description: 'Display name for the role',
    example: 'Senior Team Lead',
  })
  @IsOptional()
  @IsString({ message: 'Display name must be a string' })
  @MaxLength(100, { message: 'Display name must not exceed 100 characters' })
  displayName?: string;

  @ApiPropertyOptional({
    description: 'Role description',
    example: 'Can manage projects, tasks, and reports',
  })
  @IsOptional()
  @IsString({ message: 'Description must be a string' })
  @MaxLength(500, { message: 'Description must not exceed 500 characters' })
  description?: string;

  @ApiPropertyOptional({
    description: 'Whether the role is active',
    example: true,
  })
  @IsOptional()
  @IsBoolean({ message: 'isActive must be a boolean' })
  isActive?: boolean;

  @ApiPropertyOptional({
    description: 'Array of entity IDs to grant access to (replaces all existing)',
    example: ['entity-id-1', 'entity-id-2'],
    type: [String],
  })
  @IsOptional()
  @IsArray({ message: 'Entity IDs must be an array' })
  @IsString({ each: true, message: 'Each entity ID must be a string' })
  @ArrayMaxSize(100, { message: 'Maximum 100 entity IDs allowed' })
  entityIds?: string[];
}
