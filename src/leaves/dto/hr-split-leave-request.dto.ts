import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsDateString,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { HalfDayPeriod, LeaveCategory, LeaveType } from '@prisma/client';

export class SplitPartDto {
  @ApiProperty({
    enum: LeaveType,
    description: 'Leave type for this split portion.',
  })
  @IsEnum(LeaveType)
  leaveType: LeaveType;

  @ApiProperty({
    description: 'Start date for this split portion (ISO 8601).',
    example: '2026-04-01',
  })
  @IsDateString()
  startDate: string;

  @ApiProperty({
    description: 'End date for this split portion (ISO 8601).',
    example: '2026-04-02',
  })
  @IsDateString()
  endDate: string;

  @ApiPropertyOptional({
    enum: HalfDayPeriod,
    description: 'Half-day period. Required when leaveType is HALF_DAY.',
  })
  @IsOptional()
  @IsEnum(HalfDayPeriod)
  halfDayPeriod?: HalfDayPeriod;

  @ApiPropertyOptional({
    enum: LeaveCategory,
    description:
      'Override PAID/UNPAID for this split portion. If omitted, auto-computed from balance.',
  })
  @IsOptional()
  @IsEnum(LeaveCategory)
  category?: LeaveCategory;
}

export class HrSplitLeaveRequestDto {
  @ApiProperty({
    type: [SplitPartDto],
    description:
      'Array of split portions. The original leave will be cancelled and each portion ' +
      'created as a new APPROVED leave request. At least one split is required.',
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SplitPartDto)
  splits: SplitPartDto[];

  @ApiProperty({
    description: 'Required comment describing the reason for the split (for audit trail).',
    maxLength: 2000,
    example: '2 days split: 1 Casual + 1 WFH per manager request.',
  })
  @IsString()
  @IsNotEmpty({ message: 'A comment is required for the split operation' })
  @MaxLength(2000)
  comment: string;
}
