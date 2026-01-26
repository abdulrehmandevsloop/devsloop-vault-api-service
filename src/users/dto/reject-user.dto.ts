import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class RejectUserDto {
  @ApiPropertyOptional({
    description: 'Reason for rejection',
    maxLength: 500,
    example: 'Invalid company email domain',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
