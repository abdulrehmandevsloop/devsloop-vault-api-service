import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsOptional, IsDateString, IsArray, ArrayMinSize } from 'class-validator';

export class AssignAssetDto {
  @ApiProperty({
    description: 'Employee IDs to assign the asset to',
    example: ['clxxx123', 'clxxx456'],
    type: [String],
  })
  @IsArray()
  @ArrayMinSize(1, { message: 'Select at least one employee' })
  @IsString({ each: true })
  employeeIds: string[];

  @ApiPropertyOptional({
    description: 'Assignment date (default: today)',
    example: '2026-02-26',
  })
  @IsOptional()
  @IsDateString({}, { message: 'Assignment date must be a valid ISO date string' })
  assignmentDate?: string;
}
