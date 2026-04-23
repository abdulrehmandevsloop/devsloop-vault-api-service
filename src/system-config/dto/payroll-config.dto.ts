import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsEmail,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class PayrollConfigDto {
  @ApiProperty({ description: 'User ID of the primary payroll authorizer', example: 'clx...' })
  primaryAuthorizerId: string;

  @ApiPropertyOptional({
    description: 'Display name of the primary authorizer (resolved from user profile)',
    nullable: true,
    example: 'Ammad',
  })
  primaryAuthorizerName: string | null;

  @ApiProperty({
    description: 'User IDs of silent reviewers',
    example: ['clx...', 'cly...'],
    type: [String],
  })
  silentReviewerIds: string[];

  @ApiProperty({ description: 'HR contact email shown on payslips', example: 'hr@company.com' })
  hrEmail: string;

  @ApiProperty({ description: 'Company name on payslip stamp', example: 'DEVSLOOP' })
  companyName: string;

  @ApiProperty({
    description: 'Company tagline on payslip stamp',
    example: 'Software Development Company',
  })
  companyTagline: string;

  @ApiProperty({
    description: 'Company contact email on payslip stamp',
    example: 'contact@company.com',
  })
  companyContactEmail: string;

  @ApiProperty({ description: 'Consultant tax rate as decimal (e.g. 0.04 = 4%)', example: 0.04 })
  consultantTaxRate: number;

  @ApiProperty({ description: 'Default lunch deduction rate per day in PKR', example: 200 })
  defaultLunchRate: number;
}

export class UpdatePayrollConfigDto {
  @ApiPropertyOptional({ description: 'User ID of the primary payroll authorizer' })
  @IsOptional()
  @IsString()
  @MaxLength(30)
  primaryAuthorizerId?: string;

  @ApiPropertyOptional({ description: 'User IDs of silent reviewers', type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  silentReviewerIds?: string[];

  @ApiPropertyOptional({ description: 'HR contact email shown on payslips' })
  @IsOptional()
  @IsEmail()
  @MaxLength(320)
  hrEmail?: string;

  @ApiPropertyOptional({ description: 'Company name on payslip stamp' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  companyName?: string;

  @ApiPropertyOptional({ description: 'Company tagline on payslip stamp' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  companyTagline?: string;

  @ApiPropertyOptional({ description: 'Company contact email on payslip stamp' })
  @IsOptional()
  @IsEmail()
  @MaxLength(320)
  companyContactEmail?: string;

  @ApiPropertyOptional({ description: 'Consultant tax rate as decimal (e.g. 0.04 = 4%)' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  @Type(() => Number)
  consultantTaxRate?: number;

  @ApiPropertyOptional({ description: 'Default lunch deduction rate per day in PKR' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  defaultLunchRate?: number;
}

export class LunchDaysEntryDto {
  @ApiProperty({ example: '2026-04', description: 'Month in YYYY-MM format' })
  yearMonth: string;

  @ApiProperty({ example: 22, description: 'Number of lunch days to deduct for this month' })
  days: number;
}

export class UpsertLunchDaysDto {
  @ApiProperty({ example: 20 })
  @IsInt()
  @Min(1)
  @Type(() => Number)
  days: number;
}

export class LunchDaysMonthParamDto {
  @IsString()
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/, { message: 'yearMonth must be in YYYY-MM format' })
  yearMonth: string;
}
