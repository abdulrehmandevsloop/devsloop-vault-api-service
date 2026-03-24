import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';
import { Transform } from 'class-transformer';
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

  @ApiPropertyOptional({
    description: 'When true, return only leaves applied by HR on behalf of an employee',
    type: Boolean,
  })
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  appliedByHr?: boolean;
}
