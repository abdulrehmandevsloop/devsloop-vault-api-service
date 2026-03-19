import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsEnum, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { HalfDayPeriod, LeaveCategory, LeaveStatus, LeaveType } from '@prisma/client';

// Statuses HR is allowed to force on a leave request via modification
export const HR_ALLOWED_FORCE_STATUSES = [LeaveStatus.APPROVED, LeaveStatus.REJECTED] as const;

export class HrModifyLeaveRequestDto {
  @ApiPropertyOptional({
    description: 'New leave type. If omitted, keeps the existing type.',
    enum: LeaveType,
  })
  @IsOptional()
  @IsEnum(LeaveType)
  leaveType?: LeaveType;

  @ApiPropertyOptional({
    description: 'New start date (ISO 8601). If omitted, keeps the existing date.',
    example: '2026-04-01',
  })
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @ApiPropertyOptional({
    description: 'New end date (ISO 8601). If omitted, keeps the existing date.',
    example: '2026-04-03',
  })
  @IsOptional()
  @IsDateString()
  endDate?: string;

  @ApiPropertyOptional({
    enum: HalfDayPeriod,
    description: 'Half-day period. Required when leaveType is HALF_DAY.',
  })
  @IsOptional()
  @IsEnum(HalfDayPeriod)
  halfDayPeriod?: HalfDayPeriod;

  @ApiPropertyOptional({
    description: 'Updated reason / notes for the leave.',
    maxLength: 2000,
  })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  reason?: string;

  @ApiPropertyOptional({
    enum: HR_ALLOWED_FORCE_STATUSES,
    description:
      'Force a specific status. If omitted and details changed on an APPROVED leave, ' +
      'the status becomes MODIFIED automatically. Otherwise, the status is unchanged.',
  })
  @IsOptional()
  @IsEnum(LeaveStatus)
  status?: LeaveStatus;

  @ApiPropertyOptional({
    enum: LeaveCategory,
    description: 'Override the computed PAID/UNPAID category.',
  })
  @IsOptional()
  @IsEnum(LeaveCategory)
  category?: LeaveCategory;

  @ApiProperty({
    description: 'Required comment describing why the leave was modified (for audit trail).',
    maxLength: 2000,
    example: 'Changed from Casual to WFH per employee request.',
  })
  @IsString()
  @IsNotEmpty({ message: 'A modification comment is required' })
  @MaxLength(2000)
  comment: string;
}
