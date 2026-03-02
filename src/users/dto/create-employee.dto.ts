import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsDate,
  IsEmail,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { DEPARTMENTS } from '../../common/constants';

export class CreateEmployeeDto {
  @ApiProperty({ description: 'Full name', example: 'John Doe' })
  @IsString({ message: 'Full name must be a string' })
  @MaxLength(255, { message: 'Full name must not exceed 255 characters' })
  name: string;

  @ApiPropertyOptional({ description: 'Personal email', example: 'john.doe@gmail.com' })
  @IsOptional()
  @IsEmail({}, { message: 'Personal email must be a valid email address' })
  @MaxLength(320, { message: 'Personal email must not exceed 320 characters' })
  personalEmail?: string;

  @ApiProperty({ description: 'Company email (login email)', example: 'john.doe@devsloop.com' })
  @IsEmail({}, { message: 'Company email must be a valid email address' })
  @MaxLength(320, { message: 'Company email must not exceed 320 characters' })
  companyEmail: string;

  @ApiProperty({
    description: 'Role IDs to assign (first role is primary)',
    example: ['clx1234567890'],
    type: [String],
  })
  @IsArray({ message: 'Role IDs must be an array' })
  @ArrayNotEmpty({ message: 'At least one role is required' })
  @IsString({ each: true, message: 'Each role ID must be a string' })
  roleIds: string[];

  @ApiProperty({
    description: 'Departments the employee belongs to',
    example: ['Software Engineering'],
    type: [String],
  })
  @IsArray({ message: 'Departments must be an array' })
  @ArrayNotEmpty({ message: 'At least one department is required' })
  @IsString({ each: true, message: 'Each department must be a string' })
  @IsIn(DEPARTMENTS as unknown as string[], {
    each: true,
    message: `Each department must be one of: ${DEPARTMENTS.join(', ')}`,
  })
  departments: string[];

  @ApiProperty({ description: 'Designation', example: 'Software Engineer' })
  @IsString({ message: 'Designation must be a string' })
  @MaxLength(255, { message: 'Designation must not exceed 255 characters' })
  designation: string;

  @ApiProperty({ description: 'Joining date (ISO 8601)', example: '2026-02-01T00:00:00.000Z' })
  @Type(() => Date)
  @IsDate({ message: 'Joining date must be a valid date' })
  joiningDate: Date;

  @ApiProperty({ description: 'Monthly base salary', example: 5000 })
  @Type(() => Number)
  @IsNumber(
    { maxDecimalPlaces: 2 },
    { message: 'Base salary must be a number with at most 2 decimal places' },
  )
  @Min(0, { message: 'Base salary must be greater than or equal to 0' })
  @Max(9999999999.99, { message: 'Base salary must not exceed 9,999,999,999.99' })
  baseSalary: number;

  @ApiProperty({ description: 'Casual leave balance (days)', example: 10 })
  @Type(() => Number)
  @IsInt({ message: 'Casual leave balance must be an integer' })
  @Min(0, { message: 'Casual leave balance must be greater than or equal to 0' })
  @Max(365, { message: 'Casual leave balance must not exceed 365' })
  casualLeaveBalance: number;

  @ApiProperty({ description: 'Sick leave balance (days)', example: 8 })
  @Type(() => Number)
  @IsInt({ message: 'Sick leave balance must be an integer' })
  @Min(0, { message: 'Sick leave balance must be greater than or equal to 0' })
  @Max(365, { message: 'Sick leave balance must not exceed 365' })
  sickLeaveBalance: number;

  @ApiProperty({ description: 'Annual leave balance (days)', example: 14 })
  @Type(() => Number)
  @IsInt({ message: 'Annual leave balance must be an integer' })
  @Min(0, { message: 'Annual leave balance must be greater than or equal to 0' })
  @Max(365, { message: 'Annual leave balance must not exceed 365' })
  annualLeaveBalance: number;
}
