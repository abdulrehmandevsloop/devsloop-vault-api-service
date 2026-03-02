import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsOptional,
  IsDateString,
  MinLength,
  MaxLength,
  IsNotEmpty,
  IsInt,
  Min,
  Max,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CreateAssetDto {
  @ApiProperty({
    description: 'Asset name',
    example: 'MacBook Pro 14"',
    minLength: 1,
    maxLength: 255,
  })
  @IsNotEmpty({ message: 'Asset name is required' })
  @IsString()
  @MinLength(1, { message: 'Asset name cannot be empty' })
  @MaxLength(255, { message: 'Asset name must not exceed 255 characters' })
  assetName: string;

  @ApiProperty({
    description: 'Asset type ID (from asset types)',
    example: 'clxxx123',
  })
  @IsNotEmpty({ message: 'Asset type is required' })
  @IsString()
  assetTypeId: string;

  @ApiProperty({
    description: 'Serial number (base). When quantity > 1, serials become base-1, base-2, ...',
    example: 'SN-2024-001',
    maxLength: 255,
  })
  @IsNotEmpty({ message: 'Serial number is required' })
  @IsString()
  @MaxLength(255, { message: 'Serial number must not exceed 255 characters' })
  serialNumber: string;

  @ApiPropertyOptional({
    description: 'Number of assets to create (same type, generated serials). Default 1.',
    example: 1,
    minimum: 1,
    maximum: 100,
    default: 1,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1, { message: 'Quantity must be at least 1' })
  @Max(100, { message: 'Quantity cannot exceed 100' })
  quantity?: number = 1;

  @ApiPropertyOptional({
    description: 'Purchase date',
    example: '2024-01-15',
  })
  @IsOptional()
  @IsDateString({}, { message: 'Purchase date must be a valid ISO date string' })
  purchaseDate?: string;

  @ApiPropertyOptional({
    description: 'Additional notes',
    example: 'Company issued laptop',
  })
  @IsOptional()
  @IsString()
  @MaxLength(5000, { message: 'Notes must not exceed 5000 characters' })
  notes?: string;
}
