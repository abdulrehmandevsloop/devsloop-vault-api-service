import { IsEmail } from 'class-validator';

export class SystemUserDto {
  id: string;
  name: string;
  email: string;
}

export class UpdateSystemUserEmailDto {
  @IsEmail({}, { message: 'Must be a valid email address' })
  email: string;
}
