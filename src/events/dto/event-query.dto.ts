import { ApiPropertyOptional } from '@nestjs/swagger';
import { EventPriority, EventStatus } from '@prisma/client';
import { IsEnum, IsOptional, IsString } from 'class-validator';
import { PaginationDto } from 'src/common';

export class EventQueryDto extends PaginationDto {
  @ApiPropertyOptional({ description: 'Search in title/description' })
  @IsOptional()
  @IsString()
  q?: string;

  @ApiPropertyOptional({ enum: EventStatus })
  @IsOptional()
  @IsEnum(EventStatus)
  status?: EventStatus;

  @ApiPropertyOptional({ enum: EventPriority })
  @IsOptional()
  @IsEnum(EventPriority)
  priority?: EventPriority;

  @ApiPropertyOptional({ description: 'Due on or after this date (ISO)' })
  @IsOptional()
  @IsString()
  dueFrom?: string;

  @ApiPropertyOptional({ description: 'Due on or before this date (ISO)' })
  @IsOptional()
  @IsString()
  dueTo?: string;

  @ApiPropertyOptional({
    description: 'Only events assigned to this user (directly or via a role)',
  })
  @IsOptional()
  @IsString()
  assigneeId?: string;
}

export type MyEventsFilter = 'all' | 'upcoming' | 'overdue' | 'completed' | 'pending';

export class MyEventsQueryDto extends PaginationDto {
  @ApiPropertyOptional({
    description: 'Filter assignments',
    enum: ['all', 'upcoming', 'overdue', 'completed', 'pending'],
    default: 'all',
  })
  @IsOptional()
  @IsString()
  filter?: MyEventsFilter;

  @ApiPropertyOptional({ description: 'Search in title/description' })
  @IsOptional()
  @IsString()
  q?: string;
}
