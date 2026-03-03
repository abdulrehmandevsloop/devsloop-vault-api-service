import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { MyLeavesQueryDto } from './my-leaves-query.dto';

export class TeamLeadLeavesQueryDto extends MyLeavesQueryDto {
  @ApiPropertyOptional({
    description: 'Filter by employee department name',
    example: 'Software Engineering',
  })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  department?: string;

  @ApiPropertyOptional({
    description: 'Search by employee name, employee email, or leave reason',
    example: 'ali sick leave',
  })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  search?: string;
}
