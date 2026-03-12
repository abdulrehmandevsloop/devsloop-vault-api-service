import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsDateString,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';

export class CreateWorklogDto {
  @ApiProperty({
    description: 'Project ID (CUID) the work was performed on',
    example: 'clx1234567890abcdefghijkl',
  })
  @IsNotEmpty({ message: 'Project ID is required' })
  @IsString()
  projectId: string;

  @ApiProperty({
    description: 'Work date in YYYY-MM-DD format. Must not be a future date.',
    example: '2025-02-05',
  })
  @IsNotEmpty({ message: 'Date is required' })
  @IsDateString({}, { message: 'Date must be in YYYY-MM-DD format' })
  date: string;

  @ApiPropertyOptional({
    description: 'Mark this entry as a leave day. When true, content is not required.',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  isLeave?: boolean;

  @ApiProperty({
    description:
      'Description of work done. Required when isLeave is false. Be specific: mention components, endpoints, tickets, bugs fixed.',
    example:
      'Implemented JWT refresh token rotation in auth.service.ts. Fixed bug #234 where expired tokens were not cleared. Added unit tests for refresh endpoint covering edge cases.',
    minLength: 20,
    maxLength: 5000,
  })
  @ValidateIf((o: CreateWorklogDto) => !o.isLeave)
  @IsNotEmpty({ message: 'Work content is required' })
  @IsString()
  @MinLength(20, { message: 'Work description must be at least 20 characters' })
  @MaxLength(5000, { message: 'Work description must not exceed 5000 characters' })
  content: string;
}
