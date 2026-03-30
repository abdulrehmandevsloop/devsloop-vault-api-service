import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, Max, Min } from 'class-validator';

export class WorklogNotificationConfigDto {
  @ApiProperty({
    description: 'Hour of day grace period ends and first check runs (0–23)',
    example: 9,
  })
  @IsInt()
  @Min(0)
  @Max(23)
  @Type(() => Number)
  gracePeriodHour: number;

  @ApiProperty({
    description: 'Hour of day quiet hours start — no more notifications after this (0–23)',
    example: 22,
  })
  @IsInt()
  @Min(0)
  @Max(23)
  @Type(() => Number)
  quietHoursStart: number;

  @ApiProperty({ description: 'Hours between repeat notifications (1–24)', example: 2 })
  @IsInt()
  @Min(1)
  @Max(24)
  @Type(() => Number)
  frequencyHours: number;
}
