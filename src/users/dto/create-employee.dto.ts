import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { EmployeeStatus, EmployeeType, Gender, WorkingMode } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsDate,
  IsEmail,
  IsEnum,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
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

  @ApiProperty({ description: 'WFH allowance per month (days)', example: 1 })
  @Type(() => Number)
  @IsInt({ message: 'WFH allowance must be an integer' })
  @Min(0, { message: 'WFH allowance must be greater than or equal to 0' })
  @Max(31, { message: 'WFH allowance must not exceed 31 days per month' })
  wfhAllowancePerMonth: number;

  // ── Personal Information ──────────────────────────────────────────────

  @ApiPropertyOptional({ description: 'Date of birth', example: '1995-06-15T00:00:00.000Z' })
  @IsOptional()
  @Type(() => Date)
  @IsDate({ message: 'Date of birth must be a valid date' })
  dateOfBirth?: Date;

  @ApiPropertyOptional({ description: 'CNIC number (xxxxx-xxxxxxx-x)', example: '35202-1234567-1' })
  @IsOptional()
  @IsString({ message: 'CNIC must be a string' })
  @Matches(/^\d{5}-\d{7}-\d$/, { message: 'CNIC must be in format xxxxx-xxxxxxx-x' })
  cnic?: string;

  @ApiPropertyOptional({ description: 'Gender', enum: Gender })
  @IsOptional()
  @IsEnum(Gender, { message: `Gender must be one of: ${Object.values(Gender).join(', ')}` })
  gender?: Gender;

  @ApiPropertyOptional({ description: 'Religion', example: 'Islam' })
  @IsOptional()
  @IsString({ message: 'Religion must be a string' })
  @MaxLength(100, { message: 'Religion must not exceed 100 characters' })
  religion?: string;

  @ApiPropertyOptional({ description: 'Sect', example: 'Sunni' })
  @IsOptional()
  @IsString({ message: 'Sect must be a string' })
  @MaxLength(100, { message: 'Sect must not exceed 100 characters' })
  sect?: string;

  @ApiPropertyOptional({ description: "Father's name", example: 'Muhammad Ali' })
  @IsOptional()
  @IsString({ message: "Father's name must be a string" })
  @MaxLength(255, { message: "Father's name must not exceed 255 characters" })
  fatherName?: string;

  @ApiPropertyOptional({ description: 'Emergency contact name', example: 'Jane Doe' })
  @IsOptional()
  @IsString({ message: 'Emergency contact name must be a string' })
  @MaxLength(255, { message: 'Emergency contact name must not exceed 255 characters' })
  emergencyContactName?: string;

  @ApiPropertyOptional({ description: 'Emergency contact phone', example: '+923001234567' })
  @IsOptional()
  @IsString({ message: 'Emergency contact phone must be a string' })
  @MaxLength(20, { message: 'Emergency contact phone must not exceed 20 characters' })
  emergencyContactPhone?: string;

  @ApiPropertyOptional({ description: 'Emergency contact relation', example: 'Spouse' })
  @IsOptional()
  @IsString({ message: 'Emergency contact relation must be a string' })
  @MaxLength(100, { message: 'Emergency contact relation must not exceed 100 characters' })
  emergencyContactRelation?: string;

  // ── Employment Information ────────────────────────────────────────────

  @ApiPropertyOptional({ description: 'Employee ID', example: 'EMP-001' })
  @IsOptional()
  @IsString({ message: 'Employee ID must be a string' })
  @MaxLength(50, { message: 'Employee ID must not exceed 50 characters' })
  employeeId?: string;

  @ApiPropertyOptional({ description: 'Unique ID', example: 'UID-001' })
  @IsOptional()
  @IsString({ message: 'Unique ID must be a string' })
  @MaxLength(50, { message: 'Unique ID must not exceed 50 characters' })
  uniqueId?: string;

  @ApiPropertyOptional({ description: 'Employee type', enum: EmployeeType })
  @IsOptional()
  @IsEnum(EmployeeType, {
    message: `Employee type must be one of: ${Object.values(EmployeeType).join(', ')}`,
  })
  employeeType?: EmployeeType;

  @ApiPropertyOptional({ description: 'Employee status', enum: EmployeeStatus, default: 'ACTIVE' })
  @IsOptional()
  @IsEnum(EmployeeStatus, {
    message: `Employee status must be one of: ${Object.values(EmployeeStatus).join(', ')}`,
  })
  employeeStatus?: EmployeeStatus;

  @ApiPropertyOptional({ description: 'Probation period in days', example: 90 })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'Probation period must be an integer' })
  @Min(0, { message: 'Probation period must be >= 0' })
  @Max(730, { message: 'Probation period must not exceed 730 days' })
  probationPeriod?: number;

  @ApiPropertyOptional({ description: 'Working model', example: 'Agile' })
  @IsOptional()
  @IsString({ message: 'Working model must be a string' })
  @MaxLength(255, { message: 'Working model must not exceed 255 characters' })
  workingModel?: string;

  @ApiPropertyOptional({ description: 'Working mode', enum: WorkingMode })
  @IsOptional()
  @IsEnum(WorkingMode, {
    message: `Working mode must be one of: ${Object.values(WorkingMode).join(', ')}`,
  })
  workingMode?: WorkingMode;

  @ApiPropertyOptional({ description: 'Working shift / time', example: '9:00 AM - 6:00 PM' })
  @IsOptional()
  @IsString({ message: 'Working shift must be a string' })
  @MaxLength(100, { message: 'Working shift must not exceed 100 characters' })
  workingShift?: string;
}
