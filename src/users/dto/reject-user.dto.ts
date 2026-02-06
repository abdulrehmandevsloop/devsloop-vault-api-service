import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class RejectUserDto {
  @ApiPropertyOptional({
    description: 'Reason for rejection',
    maxLength: 500,
    example: 'Invalid company email domain',
  })
  @IsOptional()
  @IsString({ message: 'Rejection reason must be a string' })
  @MaxLength(500, { message: 'Rejection reason must not exceed 500 characters' })
  reason?: string;
}
