import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsNotEmpty,
  IsOptional,
  IsString,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import {
  PlainTextMinLength,
  PlainTextMaxLength,
} from '../../common/validators/plain-text-length.validator';

export class BulkCreateWorklogEntryDto {
  @ApiProperty({ example: 'clx1234567890abcdefghijkl' })
  @IsNotEmpty({ message: 'Project ID is required' })
  @IsString()
  projectId: string;

  @ApiProperty({ example: '2025-02-05' })
  @IsNotEmpty({ message: 'Date is required' })
  @IsDateString({}, { message: 'Date must be in YYYY-MM-DD format' })
  date: string;

  @ApiProperty({ required: false, default: false })
  @IsOptional()
  @IsBoolean()
  isLeave?: boolean;

  @ApiProperty({ minLength: 20, maxLength: 5000 })
  @ValidateIf((o: BulkCreateWorklogEntryDto) => !o.isLeave)
  @IsNotEmpty({ message: 'Work content is required' })
  @IsString()
  @PlainTextMinLength(20, { message: 'Work description must be at least 20 characters' })
  @PlainTextMaxLength(5000, { message: 'Work description must not exceed 5000 characters' })
  content: string;
}

export class BulkCreateWorklogDto {
  @ApiProperty({ type: [BulkCreateWorklogEntryDto], minItems: 1, maxItems: 30 })
  @IsArray()
  @ArrayMinSize(1, { message: 'At least one worklog entry is required' })
  @ArrayMaxSize(30, { message: 'Cannot submit more than 30 worklogs at once' })
  @ValidateNested({ each: true })
  @Type(() => BulkCreateWorklogEntryDto)
  entries: BulkCreateWorklogEntryDto[];
}

export class BulkWorklogRowResultDto {
  @ApiProperty() row: number;
  @ApiProperty() projectId: string;
  @ApiProperty() date: string;
  @ApiProperty() success: boolean;
  @ApiProperty({ required: false, type: [String] }) errors?: string[];
}

export class BulkWorklogResultDto {
  @ApiProperty() total: number;
  @ApiProperty() succeeded: number;
  @ApiProperty() failed: number;
  @ApiProperty({ type: [BulkWorklogRowResultDto] }) results: BulkWorklogRowResultDto[];
}
