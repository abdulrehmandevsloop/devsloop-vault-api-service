import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  ArrayUnique,
  ArrayMaxSize,
  ArrayMinSize,
} from 'class-validator';
import { DEPARTMENTS } from '../../common/constants';

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

  @ApiPropertyOptional({
    description: 'Departments to assign',
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
}
