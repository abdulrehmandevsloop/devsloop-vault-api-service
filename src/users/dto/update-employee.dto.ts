import { ApiPropertyOptional } from '@nestjs/swagger';
import { EmployeeStatus, EmployeeType, Gender, WorkingMode } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsDate,
  IsEmail,
  IsEnum,
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
  @IsNumber(
    { maxDecimalPlaces: 2 },
    { message: 'Base salary must be a number with at most 2 decimal places' },
  )
  @Min(0, { message: 'Base salary must be greater than or equal to 0' })
  @Max(9999999999.99, { message: 'Base salary must not exceed 9,999,999,999.99' })
  baseSalary?: number;

  @ApiPropertyOptional({
    description: 'Fixed income tax amount deducted each month (non-consultants only)',
    example: 5000,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  incomeTaxAmount?: number;

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

  @ApiPropertyOptional({
    description: 'WFH allowance per month (days)',
    example: 1,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'WFH allowance must be an integer' })
  @Min(0, { message: 'WFH allowance must be greater than or equal to 0' })
  @Max(31, { message: 'WFH allowance must not exceed 31 days per month' })
  wfhAllowancePerMonth?: number;

  // ── Personal Information ──────────────────────────────────────────────

  @ApiPropertyOptional({ description: 'Date of birth', example: '1995-06-15T00:00:00.000Z' })
  @IsOptional()
  @Type(() => Date)
  @IsDate({ message: 'Date of birth must be a valid date' })
  dateOfBirth?: Date;

  @ApiPropertyOptional({ description: 'CNIC number', example: '35202-1234567-1' })
  @IsOptional()
  @IsString({ message: 'CNIC must be a string' })
  @MaxLength(20, { message: 'CNIC must not exceed 20 characters' })
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

  @ApiPropertyOptional({ description: 'Marital status', example: 'Single' })
  @IsOptional()
  @IsString({ message: 'Marital status must be a string' })
  @MaxLength(50, { message: 'Marital status must not exceed 50 characters' })
  maritalStatus?: string;

  @ApiPropertyOptional({ description: 'Mobile number', example: '+923001234567' })
  @IsOptional()
  @IsString({ message: 'Mobile number must be a string' })
  @MaxLength(20, { message: 'Mobile number must not exceed 20 characters' })
  mobileNumber?: string;

  @ApiPropertyOptional({ description: 'Current address', example: '123 Main St, Lahore' })
  @IsOptional()
  @IsString({ message: 'Current address must be a string' })
  @MaxLength(1000, { message: 'Current address must not exceed 1000 characters' })
  currentAddress?: string;

  @ApiPropertyOptional({ description: 'Permanent address', example: '456 Old Road, Karachi' })
  @IsOptional()
  @IsString({ message: 'Permanent address must be a string' })
  @MaxLength(1000, { message: 'Permanent address must not exceed 1000 characters' })
  permanentAddress?: string;

  @ApiPropertyOptional({ description: 'City of residence', example: 'Lahore' })
  @IsOptional()
  @IsString({ message: 'City of residence must be a string' })
  @MaxLength(100, { message: 'City of residence must not exceed 100 characters' })
  cityOfResidence?: string;

  @ApiPropertyOptional({ description: 'Bank name', example: 'HBL' })
  @IsOptional()
  @IsString({ message: 'Bank name must be a string' })
  @MaxLength(255, { message: 'Bank name must not exceed 255 characters' })
  bankName?: string;

  @ApiPropertyOptional({ description: 'IBAN', example: 'PK36SCBL0000001123456702' })
  @IsOptional()
  @IsString({ message: 'IBAN must be a string' })
  @MaxLength(50, { message: 'IBAN must not exceed 50 characters' })
  iban?: string;

  @ApiPropertyOptional({ description: 'Account holder name', example: 'Ali Ahmed' })
  @IsOptional()
  @IsString({ message: 'Account holder name must be a string' })
  @MaxLength(255, { message: 'Account holder name must not exceed 255 characters' })
  accountHolderName?: string;

  @ApiPropertyOptional({ description: 'Bank code (local)', example: 'MEZN' })
  @IsOptional()
  @IsString({ message: 'Bank code must be a string' })
  @MaxLength(50, { message: 'Bank code must not exceed 50 characters' })
  bankCode?: string;

  @ApiPropertyOptional({
    description: 'SWIFT / BIC code for international remittance',
    example: 'MEZNPKKA',
  })
  @IsOptional()
  @IsString({ message: 'SWIFT code must be a string' })
  @MaxLength(20, { message: 'SWIFT code must not exceed 20 characters' })
  swiftCode?: string;

  @ApiPropertyOptional({ description: 'Province / State', example: 'Punjab' })
  @IsOptional()
  @IsString({ message: 'Province must be a string' })
  @MaxLength(100, { message: 'Province must not exceed 100 characters' })
  province?: string;

  @ApiPropertyOptional({ description: 'Education level', example: "Bachelor's" })
  @IsOptional()
  @IsString({ message: 'Education level must be a string' })
  @MaxLength(100, { message: 'Education level must not exceed 100 characters' })
  educationLevel?: string;

  @ApiPropertyOptional({ description: 'Highest qualification', example: 'BS Computer Science' })
  @IsOptional()
  @IsString({ message: 'Highest qualification must be a string' })
  @MaxLength(255, { message: 'Highest qualification must not exceed 255 characters' })
  highestQualification?: string;

  @ApiPropertyOptional({ description: 'Institution name', example: 'LUMS' })
  @IsOptional()
  @IsString({ message: 'Institution name must be a string' })
  @MaxLength(255, { message: 'Institution name must not exceed 255 characters' })
  institutionName?: string;

  @ApiPropertyOptional({ description: 'Field of study', example: 'Computer Science' })
  @IsOptional()
  @IsString({ message: 'Field of study must be a string' })
  @MaxLength(255, { message: 'Field of study must not exceed 255 characters' })
  fieldOfStudy?: string;

  @ApiPropertyOptional({ description: 'Employee reference', example: 'John Smith' })
  @IsOptional()
  @IsString({ message: 'Employee reference must be a string' })
  @MaxLength(255, { message: 'Employee reference must not exceed 255 characters' })
  employeeReference?: string;

  @ApiPropertyOptional({ description: 'Area of expertise', example: 'Backend Development' })
  @IsOptional()
  @IsString({ message: 'Area of expertise must be a string' })
  @MaxLength(255, { message: 'Area of expertise must not exceed 255 characters' })
  areaOfExpertise?: string;

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

  @ApiPropertyOptional({ description: 'Employee type', enum: EmployeeType })
  @IsOptional()
  @IsEnum(EmployeeType, {
    message: `Employee type must be one of: ${Object.values(EmployeeType).join(', ')}`,
  })
  employeeType?: EmployeeType;

  @ApiPropertyOptional({ description: 'Employee status', enum: EmployeeStatus })
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

  @ApiPropertyOptional({ description: 'Working days', example: 'Mon-Fri' })
  @IsOptional()
  @IsString({ message: 'Working days must be a string' })
  @MaxLength(100, { message: 'Working days must not exceed 100 characters' })
  workingDays?: string;

  @ApiPropertyOptional({ description: 'Team lead name', example: 'Ali Hassan' })
  @IsOptional()
  @IsString({ message: 'Team lead must be a string' })
  @MaxLength(255, { message: 'Team lead must not exceed 255 characters' })
  teamLead?: string;
}
