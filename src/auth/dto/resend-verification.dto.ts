import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty, MaxLength } from 'class-validator';

export class ResendVerificationDto {
  @ApiProperty({
    example: 'user@devsloop.com',
    description: 'Email address to resend verification to',
  })
  @IsEmail({}, { message: 'Please provide a valid email address' })
  @IsNotEmpty({ message: 'Email is required' })
  @MaxLength(320, { message: 'Email must not exceed 320 characters' })
  email: string;
}
