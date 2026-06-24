import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class BirthdayResponseDto {
  @ApiProperty({
    description: 'Employee unique identifier',
    example: 'clxyz1234abc',
  })
  id: string;

  @ApiProperty({
    description: 'Employee full name',
    example: 'Jane Doe',
  })
  name: string;

  @ApiPropertyOptional({
    description: 'URL of employee profile picture',
    example: 'https://example.com/avatars/jane.jpg',
    nullable: true,
  })
  profilePicture: string | null;

  @ApiProperty({
    description: 'Employee date of birth as ISO 8601 string',
    example: '1995-06-15T00:00:00.000Z',
  })
  birthday: string;

  @ApiProperty({
    description: 'Number of days until the next birthday occurrence (0 = today)',
    example: 0,
  })
  daysUntilBirthday: number;
}