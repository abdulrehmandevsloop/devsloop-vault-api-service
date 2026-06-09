import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { EventPriority, EventStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayUnique,
  IsArray,
  IsDateString,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';

export class EventAttachmentInputDto {
  @ApiProperty({ example: 'policy.pdf' })
  @IsString()
  @MaxLength(512)
  fileName: string;

  @ApiProperty({ example: 'https://storage.example.com/events/abc.pdf' })
  @IsString()
  @MaxLength(2048)
  fileUrl: string;

  @ApiPropertyOptional({ example: 102400 })
  @IsOptional()
  @Type(() => Number)
  fileSize?: number;
}

export class CreateEventDto {
  @ApiProperty({ example: 'Complete annual security training' })
  @IsString({ message: 'Title must be a string' })
  @MaxLength(255, { message: 'Title can be up to 255 characters' })
  title: string;

  @ApiPropertyOptional({ example: 'Watch the video and complete the quiz by the deadline.' })
  @IsOptional()
  @IsString({ message: 'Description must be a string' })
  description?: string;

  @ApiPropertyOptional({ example: '2026-06-10' })
  @IsOptional()
  @IsDateString({}, { message: 'Start date must be a valid date string' })
  startDate?: string;

  @ApiProperty({ example: '2026-06-30' })
  @IsDateString({}, { message: 'Due date must be a valid date string' })
  dueDate: string;

  @ApiPropertyOptional({ enum: EventPriority, default: EventPriority.MEDIUM })
  @IsOptional()
  @IsEnum(EventPriority, { message: 'Invalid priority' })
  priority?: EventPriority;

  @ApiPropertyOptional({ enum: EventStatus, default: EventStatus.ACTIVE })
  @IsOptional()
  @IsEnum(EventStatus, { message: 'Invalid status' })
  status?: EventStatus;

  @ApiPropertyOptional({ type: [String], description: 'User IDs assigned directly' })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  userIds?: string[];

  @ApiPropertyOptional({ type: [String], description: 'Role IDs assigned (dynamic membership)' })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  roleIds?: string[];

  @ApiPropertyOptional({ type: [EventAttachmentInputDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => EventAttachmentInputDto)
  attachments?: EventAttachmentInputDto[];
}
