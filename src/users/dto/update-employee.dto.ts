import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
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

export class UpdateEmployeeDto {
  @ApiPropertyOptional({ description: 'Full name', example: 'John Doe' })
  @IsOptional()
  @IsString({ message: 'Full name must be a string' })
  @MaxLength(255, { message: 'Full name must not exceed 255 characters' })
  name?: string;

  @ApiPropertyOptional({ description: 'Personal email', example: 'john.doe@gmail.com' })
  @IsOptional()
  @IsEmail({}, { message: 'Personal email must be a valid email address' })
  @MaxLength(320, { message: 'Personal email must not exceed 320 characters' })
  personalEmail?: string;

  @ApiPropertyOptional({
    description: 'Company email (login email)',
    example: 'john.doe@devsloop.com',
  })
  @IsOptional()
  @IsEmail({}, { message: 'Company email must be a valid email address' })
  @MaxLength(320, { message: 'Company email must not exceed 320 characters' })
  companyEmail?: string;

  @ApiPropertyOptional({
    description: 'Departments the employee belongs to',
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

  @ApiPropertyOptional({ description: 'Designation', example: 'Software Engineer' })
  @IsOptional()
  @IsString({ message: 'Designation must be a string' })
  @MaxLength(255, { message: 'Designation must not exceed 255 characters' })
  designation?: string;

  @ApiPropertyOptional({
    description: 'Joining date (ISO 8601)',
    example: '2026-02-01T00:00:00.000Z',
  })
  @IsOptional()
  @Type(() => Date)
  @IsDate({ message: 'Joining date must be a valid date' })
  joiningDate?: Date;

  @ApiPropertyOptional({
    description: 'Leave date (ISO 8601)',
    example: '2027-12-31T00:00:00.000Z',
  })
  @IsOptional()
  @Type(() => Date)
  @IsDate({ message: 'Leave date must be a valid date' })
  leaveDate?: Date;

  @ApiPropertyOptional({ description: 'Monthly base salary', example: 5000 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({}, { message: 'Base salary must be a number' })
  @Min(0, { message: 'Base salary must be greater than or equal to 0' })
  baseSalary?: number;

  @ApiPropertyOptional({ description: 'Casual leave balance (days)', example: 10 })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'Casual leave balance must be an integer' })
  @Min(0, { message: 'Casual leave balance must be greater than or equal to 0' })
  @Max(365, { message: 'Casual leave balance must not exceed 365' })
  casualLeaveBalance?: number;

  @ApiPropertyOptional({ description: 'Sick leave balance (days)', example: 8 })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'Sick leave balance must be an integer' })
  @Min(0, { message: 'Sick leave balance must be greater than or equal to 0' })
  @Max(365, { message: 'Sick leave balance must not exceed 365' })
  sickLeaveBalance?: number;

  @ApiPropertyOptional({ description: 'Annual leave balance (days)', example: 14 })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'Annual leave balance must be an integer' })
  @Min(0, { message: 'Annual leave balance must be greater than or equal to 0' })
  @Max(365, { message: 'Annual leave balance must not exceed 365' })
  annualLeaveBalance?: number;
}
