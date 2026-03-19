import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsDateString,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { LeaveCategory, LeaveType } from '@prisma/client';

const SPECIAL_LEAVE_TYPES = [
  LeaveType.MATERNITY,
  LeaveType.WEDDING,
  LeaveType.UMRAH_HAJJ,
  LeaveType.OTHER,
] as const;

export class HrApplySpecialLeaveDto {
  @ApiProperty({
    description: 'Employee ID to apply the special leave for',
    example: 'cuid1234567890abcdef',
  })
  @IsString()
  @IsNotEmpty()
  employeeId: string;

  @ApiProperty({
    enum: SPECIAL_LEAVE_TYPES,
    description: 'Special leave type (MATERNITY, WEDDING, UMRAH_HAJJ, or OTHER)',
    example: LeaveType.MATERNITY,
  })
  @IsEnum(LeaveType, {
    message: `leaveType must be one of: ${SPECIAL_LEAVE_TYPES.join(', ')}`,
  })
  leaveType: LeaveType;

  @ApiProperty({
    description: 'Start date of leave (YYYY-MM-DD)',
    example: '2026-04-10',
  })
  @IsDateString()
  startDate: string;

  @ApiProperty({
    description: 'End date of leave (YYYY-MM-DD). Must be >= startDate.',
    example: '2026-04-12',
  })
  @IsDateString()
  endDate: string;

  @ApiProperty({
    description: 'Reason for the special leave',
    maxLength: 2000,
    example: 'Maternity leave for employee as per company policy.',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  reason: string;

  @ApiPropertyOptional({
    description: 'HR comment / note for this leave application',
    maxLength: 2000,
  })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  comment?: string;

  @ApiPropertyOptional({
    description: 'URL to uploaded medical certificate (for MATERNITY leave).',
    maxLength: 2048,
  })
  @IsOptional()
  @ValidateIf((o) => o.leaveType === LeaveType.MATERNITY)
  @IsString()
  @MaxLength(2048)
  medicalCertificateUrl?: string;

  @ApiPropertyOptional({
    enum: LeaveCategory,
    description: 'Override the computed PAID/UNPAID category. Omit to let the system auto-compute.',
  })
  @IsOptional()
  @IsEnum(LeaveCategory)
  category?: LeaveCategory;
}
