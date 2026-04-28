import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class WorkflowActionDto {
  @ApiPropertyOptional({ description: 'Optional comment for the action', maxLength: 2000 })
  @IsString()
  @MaxLength(2000)
  @IsOptional()
  comment?: string;
}
