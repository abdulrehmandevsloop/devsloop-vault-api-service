import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsOptional, IsBoolean, MinLength, MaxLength } from 'class-validator';

export class UpdateAssetTypeDto {
  @ApiPropertyOptional({
    description: 'Asset type name',
    example: 'Laptop',
    minLength: 1,
    maxLength: 100,
  })
  @IsOptional()
  @IsString()
  @MinLength(1, { message: 'Name cannot be empty' })
  @MaxLength(100, { message: 'Name must not exceed 100 characters' })
  name?: string;

  @ApiPropertyOptional({
    description: 'Whether the type is active (inactive types are hidden from dropdowns)',
    example: true,
  })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
