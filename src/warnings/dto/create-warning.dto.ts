import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty, MaxLength } from 'class-validator';

export class CreateWarningDto {
  @ApiProperty({
    description: 'Warning message or reason',
    example: 'Repeated late submissions.',
    maxLength: 2000,
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  message: string;
}
