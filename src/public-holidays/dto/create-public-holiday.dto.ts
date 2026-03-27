import { ApiProperty } from '@nestjs/swagger';
import { IsDateString, IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class CreatePublicHolidayDto {
  @ApiProperty({ description: 'Date of the holiday (YYYY-MM-DD)', example: '2026-08-14' })
  @IsDateString()
  @IsNotEmpty()
  date: string;

  @ApiProperty({ description: 'Holiday name', example: 'Independence Day' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name: string;
}
