import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { TeamLeadLeavesQueryDto } from './team-lead-leaves-query.dto';

export class HrLeavesQueryDto extends TeamLeadLeavesQueryDto {
  @ApiPropertyOptional({
    description: 'Filter by employee ID (CUID)',
    example: 'cuid1234567890abcdef',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  employeeId?: string;
}
