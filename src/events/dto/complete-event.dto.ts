import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsArray, IsOptional, IsString, MaxLength, ValidateNested } from 'class-validator';
import { EventAttachmentInputDto } from './create-event.dto';

export class CompleteEventDto {
  @ApiPropertyOptional({ example: 'Completed the training and passed the quiz with 95%.' })
  @IsOptional()
  @IsString({ message: 'Notes must be a string' })
  @MaxLength(5000, { message: 'Notes can be up to 5000 characters' })
  notes?: string;

  @ApiPropertyOptional({
    type: [EventAttachmentInputDto],
    description: 'Supporting evidence files',
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => EventAttachmentInputDto)
  attachments?: EventAttachmentInputDto[];
}
