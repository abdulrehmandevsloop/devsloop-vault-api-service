import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsEmail,
  IsIn,
  IsNotEmpty,
  IsString,
  MinLength,
  IsOptional,
  Matches,
} from 'class-validator';
import { DEPARTMENTS } from '../../common/constants';

export class RegisterDto {
  @ApiProperty({ example: 'john@devsloop.com', description: 'Valid email address' })
  @IsEmail({}, { message: 'Please provide a valid email address' })
  @IsNotEmpty({ message: 'Email is required' })
  email: string;

  @ApiProperty({ example: 'John Developer' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({
    example: 'SecurePassword123!',
    description:
      'Password (min 8 chars, must contain uppercase, lowercase, number, and special character)',
    minLength: 8,
  })
  @IsString()
  @IsNotEmpty({ message: 'Password is required' })
  @MinLength(8, { message: 'Password must be at least 8 characters long' })
  @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/, {
    message:
      'Password must contain at least one uppercase letter, one lowercase letter, one number, and one special character',
  })
  password: string;

  @ApiPropertyOptional({
    description: 'Departments',
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
