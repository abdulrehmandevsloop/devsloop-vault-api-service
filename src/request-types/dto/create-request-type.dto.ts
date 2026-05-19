import { IsArray, IsOptional, IsString, Matches, MaxLength, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { FormFieldDto } from './form-field.dto';

export class CreateRequestTypeDto {
  @ApiProperty({ description: 'Unique SCREAMING_SNAKE_CASE key, e.g. TRAINING_REQUEST' })
  @IsString()
  @MaxLength(100)
  @Matches(/^[A-Z][A-Z0-9_]*$/, {
    message: 'key must be SCREAMING_SNAKE_CASE (e.g. TRAINING_REQUEST)',
  })
  key: string;

  @ApiProperty()
  @IsString()
  @MaxLength(255)
  name: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  description?: string;

  @ApiPropertyOptional({ description: 'Lucide icon name or emoji (e.g. "calendar")' })
  @IsString()
  @MaxLength(50)
  @IsOptional()
  icon?: string;

  @ApiPropertyOptional({
    description: 'Color name: emerald | blue | amber | violet | rose | cyan | orange | pink',
  })
  @IsString()
  @MaxLength(50)
  @IsOptional()
  color?: string;

  @ApiProperty({ type: [FormFieldDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => FormFieldDto)
  fieldSchema: FormFieldDto[];
}
