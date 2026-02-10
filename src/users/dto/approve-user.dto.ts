import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  ArrayUnique,
  ArrayMaxSize,
  ArrayMinSize,
} from 'class-validator';

export class ApproveUserDto {
  @ApiProperty({
    description:
      'Array of role IDs to assign to the user. The first role is marked as the primary role. Replaces all existing role assignments.',
    example: ['clx1234567890', 'clx0987654321'],
    type: [String],
  })
  @IsArray()
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  @ArrayUnique()
  @ArrayMinSize(1, { message: 'At least one role must be assigned' })
  @ArrayMaxSize(20, { message: 'Cannot assign more than 20 roles at once' })
  roleIds: string[];

  @ApiPropertyOptional({ description: 'Department to assign' })
  @IsOptional()
  @IsString({ message: 'Department must be a string' })
  @MaxLength(100, { message: 'Department must not exceed 100 characters' })
  department?: string;
}
