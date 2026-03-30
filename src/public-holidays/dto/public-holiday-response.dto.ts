import { ApiProperty } from '@nestjs/swagger';

export class PublicHolidayResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty({ example: '2026-08-14' })
  date: string;

  @ApiProperty({ example: 'Independence Day' })
  name: string;

  @ApiProperty()
  createdAt: Date;
}
