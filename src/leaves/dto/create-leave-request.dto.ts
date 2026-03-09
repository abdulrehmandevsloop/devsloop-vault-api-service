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
import { HalfDayPeriod, LeaveType } from '@prisma/client';

export class CreateLeaveRequestDto {
  @ApiProperty({
    description: 'ID of the reporting manager (must be a user with leave-review entity access)',
    example: 'cuid1234567890abcdef',
  })
  @IsString()
  @IsNotEmpty()
  reportingManagerId: string;

  @ApiProperty({
    enum: LeaveType,
    description: 'Type of leave being requested',
    example: LeaveType.CASUAL,
  })
  @IsEnum(LeaveType)
  leaveType: LeaveType;

  @ApiProperty({
    description: 'Start date of leave (YYYY-MM-DD)',
    example: '2026-04-10',
  })
  @IsDateString()
  startDate: string;

  @ApiProperty({
    description:
      'End date of leave (YYYY-MM-DD). Must be >= startDate. For HALF_DAY and WFH must equal startDate.',
    example: '2026-04-12',
  })
  @IsDateString()
  endDate: string;

  @ApiPropertyOptional({
    enum: HalfDayPeriod,
    description: 'Required when leaveType is HALF_DAY',
  })
  @ValidateIf((o) => o.leaveType === LeaveType.HALF_DAY)
  @IsEnum(HalfDayPeriod)
  halfDayPeriod?: HalfDayPeriod;

  @ApiProperty({
    description: 'Reason for the leave request',
    maxLength: 2000,
    example: 'Personal appointment that cannot be rescheduled.',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  reason: string;

  @ApiPropertyOptional({
    description:
      'URL to uploaded medical certificate. Required for SICK and MATERNITY leave types.',
    maxLength: 2048,
  })
  @IsOptional()
  @ValidateIf((o) => o.leaveType === LeaveType.SICK || o.leaveType === LeaveType.MATERNITY)
  @IsString()
  @IsNotEmpty({ message: 'medicalCertificateUrl is required for SICK and MATERNITY leave' })
  @MaxLength(2048)
  medicalCertificateUrl?: string;
}
