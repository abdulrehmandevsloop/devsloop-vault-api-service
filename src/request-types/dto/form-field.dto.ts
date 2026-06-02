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
  | 'FILE_UPLOAD'
  | 'RATING_MATRIX';

export type DataSourceType =
  | 'STATIC'
  | 'ENTITY'
  | 'ROLE'
  | 'USER'
  | 'REPORTING_MANAGER'
  | 'ALL_USERS';

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
  'RATING_MATRIX',
];

const DATA_SOURCE_TYPES: DataSourceType[] = [
  'STATIC',
  'ENTITY',
  'ROLE',
  'USER',
  'REPORTING_MANAGER',
  'ALL_USERS',
];

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

export class MatrixRowDto {
  @ApiProperty({ description: 'Stable key used in submitted formData (formData[fieldId][rowId])' })
  @IsString()
  @MaxLength(100)
  id: string;

  @ApiProperty({ description: 'Row label shown to the user, e.g. "Communication Skills"' })
  @IsString()
  @MaxLength(255)
  label: string;
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

  // RATING_MATRIX
  @ApiPropertyOptional({
    type: [MatrixRowDto],
    description: 'Rows of the rating grid (e.g. each soft-skill criterion)',
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => MatrixRowDto)
  @IsOptional()
  matrixRows?: MatrixRowDto[];

  @ApiPropertyOptional({ description: 'Lowest value of the rating scale (default 1)' })
  @IsInt()
  @IsOptional()
  scaleMin?: number;

  @ApiPropertyOptional({ description: 'Highest value of the rating scale (e.g. 5, 8, 10)' })
  @IsInt()
  @Min(1)
  @Max(100)
  @IsOptional()
  scaleMax?: number;

  // Multi-page forms — 1-based page the field belongs to (default 1). A form is
  // paginated only when a field sits on a page > 1. pageTitle carries the page's
  // display name (stored per-field; any field on the page may carry it).
  @ApiPropertyOptional({ description: '1-based page this field belongs to (default 1)' })
  @IsInt()
  @Min(1)
  @IsOptional()
  page?: number;

  @ApiPropertyOptional({ description: 'Display title for the page this field is on' })
  @IsString()
  @MaxLength(255)
  @IsOptional()
  pageTitle?: string;

  @ApiPropertyOptional({ type: ShowWhenDto })
  @ValidateNested()
  @Type(() => ShowWhenDto)
  @IsOptional()
  showWhen?: ShowWhenDto;
}
