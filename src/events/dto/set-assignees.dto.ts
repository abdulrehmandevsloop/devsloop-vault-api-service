import { ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayUnique, IsArray, IsOptional, IsString } from 'class-validator';

export class SetAssigneesDto {
  @ApiPropertyOptional({ type: [String], description: 'User IDs assigned directly', default: [] })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  userIds?: string[];

  @ApiPropertyOptional({
    type: [String],
    description: 'Role IDs assigned (dynamic membership)',
    default: [],
  })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  roleIds?: string[];
}
