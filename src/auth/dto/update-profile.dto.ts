import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsIn, IsOptional, IsString, MaxLength, ValidateIf } from 'class-validator';
import { DEPARTMENTS } from '../../common/constants';

export class UpdateProfileDto {
  @ApiPropertyOptional({ description: 'Display name', maxLength: 255 })
  @IsOptional()
  @IsString()
  @MaxLength(255, { message: 'Name must be at most 255 characters' })
  name?: string;

  @ApiPropertyOptional({
    description: 'Departments the user belongs to',
    example: ['Software Engineering'],
    type: [String],
  })
  @IsOptional()
  @IsArray({ message: 'Departments must be an array' })
  @IsString({ each: true, message: 'Each department must be a string' })
  @IsIn(DEPARTMENTS as unknown as string[], {
    each: true,
    message: `Each department must be one of: ${DEPARTMENTS.join(', ')}`,
  })
  departments?: string[];

  @ApiPropertyOptional({ description: 'Avatar image URL (e.g. from Supabase Storage)' })
  @IsOptional()
  @ValidateIf((_o, v) => v != null && v !== '')
  @IsString()
  @MaxLength(2048, { message: 'Avatar URL must be at most 2048 characters' })
  avatarUrl?: string | null;

  @ApiPropertyOptional({
    description: 'Bio for knowledge base profile (max 2000 characters)',
    maxLength: 2000,
  })
  @IsOptional()
  @ValidateIf((_o, v) => v != null && v !== '')
  @IsString()
  @MaxLength(2000, { message: 'Bio must be at most 2000 characters' })
  bio?: string | null;
}
