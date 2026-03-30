import { IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class ProcessInstallmentDto {
  @ApiPropertyOptional({ description: 'Optional processing notes', maxLength: 1000 })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  processingNotes?: string;
}
