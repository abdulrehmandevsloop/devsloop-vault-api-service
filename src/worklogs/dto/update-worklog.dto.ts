import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';

export class UpdateWorklogDto {
  @ApiPropertyOptional({
    description: 'New project ID (CUID). Must be a project the user is assigned to.',
    example: 'clx1234567890abcdefghijkl',
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  projectId?: string;

  @ApiPropertyOptional({
    description: 'Mark as leave day. When true, content is not required.',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  isLeave?: boolean;

  @ApiPropertyOptional({
    description:
      'Updated work description. Required when isLeave is false. Min 20, max 5000 characters.',
    minLength: 20,
    maxLength: 5000,
  })
  @ValidateIf((o: UpdateWorklogDto) => !(o.isLeave === true))
  @IsOptional()
  @IsString()
  @MinLength(20, { message: 'Work description must be at least 20 characters' })
  @MaxLength(5000, { message: 'Work description must not exceed 5000 characters' })
  content?: string;
}
