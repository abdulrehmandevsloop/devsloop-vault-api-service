import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  ValidateNested,
  Min,
  Max,
  MaxLength,
  IsArray,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export type FieldType =
  | 'TEXT'
  | 'TEXTAREA'
  | 'NUMBER'
  | 'DATE'
  | 'DATE_RANGE'
  | 'SELECT'
  | 'MULTI_SELECT'
  | 'CHECKBOX'
  | 'FILE_UPLOAD';

export type DataSourceType = 'STATIC' | 'ENTITY' | 'ROLE' | 'USER';

const FIELD_TYPES: FieldType[] = [
  'TEXT',
  'TEXTAREA',
  'NUMBER',
  'DATE',
  'DATE_RANGE',
  'SELECT',
  'MULTI_SELECT',
  'CHECKBOX',
  'FILE_UPLOAD',
];

const DATA_SOURCE_TYPES: DataSourceType[] = ['STATIC', 'ENTITY', 'ROLE', 'USER'];

export class ShowWhenDto {
  @ApiProperty({ description: 'ID of the controlling field' })
  @IsString()
  fieldId!: string;

  @ApiProperty({
    type: [String],
    description: 'Field is visible when controlling field equals one of these values',
  })
  @IsArray()
  @IsString({ each: true })
  values!: string[];
}

export class StaticOptionDto {
  @ApiProperty()
  @IsString()
  label: string;

  @ApiProperty()
  @IsString()
  value: string;
}

export class FormFieldDto {
  @ApiProperty({ description: 'Unique field key used as the key in submitted formData' })
  @IsString()
  @MaxLength(100)
  id: string;

  @ApiProperty()
  @IsString()
  @MaxLength(255)
  label: string;

  @ApiProperty({ enum: FIELD_TYPES })
  @IsEnum(FIELD_TYPES)
  type: FieldType;

  @ApiProperty()
  @IsBoolean()
  required: boolean;

  @ApiProperty()
  @IsInt()
  @Min(0)
  order: number;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  placeholder?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  helpText?: string;

  // SELECT / MULTI_SELECT
  @ApiPropertyOptional({ enum: DATA_SOURCE_TYPES })
  @IsEnum(DATA_SOURCE_TYPES)
  @IsOptional()
  dataSource?: DataSourceType;

  @ApiPropertyOptional({ type: [StaticOptionDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => StaticOptionDto)
  @IsOptional()
  staticOptions?: StaticOptionDto[];

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  entitySource?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  roleSource?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  userSource?: string;

  // TEXT
  @ApiPropertyOptional()
  @IsInt()
  @Min(0)
  @IsOptional()
  minLength?: number;

  @ApiPropertyOptional()
  @IsInt()
  @Min(0)
  @IsOptional()
  maxLength?: number;

  // NUMBER
  @ApiPropertyOptional()
  @IsNumber()
  @IsOptional()
  min?: number;

  @ApiPropertyOptional()
  @IsNumber()
  @IsOptional()
  max?: number;

  // FILE_UPLOAD
  @ApiPropertyOptional({ type: [String] })
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  acceptedTypes?: string[];

  @ApiPropertyOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  @IsOptional()
  maxFileSizeMb?: number;

  @ApiPropertyOptional({ type: ShowWhenDto })
  @ValidateNested()
  @Type(() => ShowWhenDto)
  @IsOptional()
  showWhen?: ShowWhenDto;
}
