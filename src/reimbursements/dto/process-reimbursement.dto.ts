import { IsString, IsOptional, MaxLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class ProcessReimbursementDto {
  @ApiPropertyOptional({ description: 'Processing notes for admin use', maxLength: 1000 })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  processingNotes?: string;
}
