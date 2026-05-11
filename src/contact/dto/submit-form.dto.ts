import {
  IsEmail,
  IsEnum,
  IsNotEmpty,
  IsString,
  MaxLength,
  IsDateString,
  ValidateIf,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export enum FormType {
  CONTACT = 'contact',
  BOOKING = 'booking',
}

export class SubmitFormDto {
  @ApiProperty({ enum: FormType, description: 'Which form is being submitted' })
  @IsEnum(FormType)
  type!: FormType;

  @ApiProperty({ example: 'John Doe' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name!: string;

  @ApiProperty({ example: 'john@example.com' })
  @IsEmail()
  email!: string;

  @ApiProperty({ example: 'Hello, I would like to discuss...' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  message!: string;

  @ApiProperty({ example: 'Acme Corp' })
  @ValidateIf((o) => o.type === FormType.BOOKING)
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  organization?: string;

  @ApiProperty({ example: 'AI Summit 2026' })
  @ValidateIf((o) => o.type === FormType.BOOKING)
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  eventName?: string;

  @ApiProperty({ example: '2026-08-15' })
  @ValidateIf((o) => o.type === FormType.BOOKING)
  @IsDateString()
  eventDate?: string;

  @ApiProperty({ example: '200–500' })
  @ValidateIf((o) => o.type === FormType.BOOKING)
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  audienceSize?: string;

  @ApiProperty({ example: 'Scaling AI Teams from 3 to 300+' })
  @ValidateIf((o) => o.type === FormType.BOOKING)
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  topic?: string;

  @ApiProperty({ example: '$10,000 – $25,000' })
  @ValidateIf((o) => o.type === FormType.BOOKING)
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  budget?: string;
}
