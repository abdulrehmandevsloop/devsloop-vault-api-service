import { ApiProperty } from '@nestjs/swagger';

export class BirthdayResponseDto {
  @ApiProperty({ description: 'User ID' })
  id: string;

  @ApiProperty({ description: 'Employee full name' })
  name: string;

  @ApiProperty({ description: 'Profile picture URL', nullable: true })
  profilePicture: string | null;

  @ApiProperty({ description: 'Birthday date (ISO string)' })
  birthday: string;

  @ApiProperty({ description: 'Days until birthday (0 = today, 1-7 = upcoming)' })
  daysUntilBirthday: number;
}