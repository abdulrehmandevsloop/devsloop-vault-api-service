import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class HrReviewLeaveRequestDto {
  @ApiProperty({
    description: 'HR review comment (required for both approve and reject)',
    maxLength: 2000,
    example: 'Approved. Leave balance updated accordingly.',
  })
  @IsString()
  @IsNotEmpty({ message: 'A comment is required when making the final HR decision' })
  @MaxLength(2000)
  comment: string;
}
