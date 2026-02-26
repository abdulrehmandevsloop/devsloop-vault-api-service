import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty, MaxLength, IsEnum, IsOptional } from 'class-validator';
import { WarningType } from '@prisma/client';

export class CreateWarningDto {
  @ApiProperty({
    description: 'Warning message or reason',
    example: 'Repeated late submissions.',
    maxLength: 2000,
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  message: string;

  @ApiProperty({
    description: 'Severity type of the warning',
    enum: WarningType,
    default: WarningType.MINOR,
    required: false,
  })
  @IsEnum(WarningType)
  @IsOptional()
  warningType?: WarningType;
}
