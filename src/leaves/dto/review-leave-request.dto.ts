import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class ReviewLeaveRequestDto {
  @ApiProperty({
    description: 'Review comment (required for both approve and reject)',
    maxLength: 2000,
    example: 'Approved. Coverage has been arranged with the team.',
  })
  @IsString()
  @IsNotEmpty({ message: 'A comment is required when reviewing a leave request' })
  @MaxLength(2000)
  comment: string;
}
