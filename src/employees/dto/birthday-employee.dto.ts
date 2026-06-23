import { IsString, IsInt, IsOptional, Min } from 'class-validator';

export class BirthdayEmployeeDto {
  @IsString()
  id: string;

  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  profilePicture: string | null;

  @IsString()
  birthday: string;

  @IsInt()
  @Min(0)
  daysUntilBirthday: number;
}