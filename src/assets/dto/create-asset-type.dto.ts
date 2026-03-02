import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsNotEmpty, MinLength, MaxLength, IsOptional, IsBoolean } from 'class-validator';

export class CreateAssetTypeDto {
  @ApiProperty({
    description: 'Asset type name (e.g. Laptop, Monitor)',
    example: 'Laptop',
    minLength: 1,
    maxLength: 100,
  })
  @IsNotEmpty({ message: 'Name is required' })
  @IsString()
  @MinLength(1, { message: 'Name cannot be empty' })
  @MaxLength(100, { message: 'Name must not exceed 100 characters' })
  name: string;

  @ApiPropertyOptional({
    description:
      'Whether the type is active (default true). Inactive types are hidden from dropdowns.',
    example: true,
  })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
