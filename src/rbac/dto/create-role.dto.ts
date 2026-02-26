import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsArray,
  IsBoolean,
  MaxLength,
  ArrayMaxSize,
} from 'class-validator';

export class CreateRoleDto {
  @ApiProperty({
    description: 'Role name (must be unique, lowercase, no spaces)',
    example: 'team-lead',
    maxLength: 100,
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100, { message: 'Role name must not exceed 100 characters' })
  name: string;

  @ApiProperty({
    description: 'Display name for the role',
    example: 'Team Lead',
    maxLength: 255,
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255, { message: 'Display name must not exceed 255 characters' })
  displayName: string;

  @ApiPropertyOptional({
    description: 'Role description',
    example: 'Can manage projects and tasks',
  })
  @IsOptional()
  @IsString({ message: 'Description must be a string' })
  @MaxLength(500, { message: 'Description must not exceed 500 characters' })
  description?: string;

  @ApiPropertyOptional({
    description: 'Whether the role is active',
    example: true,
    default: true,
  })
  @IsOptional()
  @IsBoolean({ message: 'isActive must be a boolean' })
  isActive?: boolean;

  @ApiPropertyOptional({
    description: 'Array of entity IDs to grant access to',
    example: ['entity-id-1', 'entity-id-2'],
    type: [String],
  })
  @IsOptional()
  @IsArray({ message: 'Entity IDs must be an array' })
  @IsString({ each: true, message: 'Each entity ID must be a string' })
  @ArrayMaxSize(100, { message: 'Maximum 100 entity IDs allowed' })
  entityIds?: string[];
}
