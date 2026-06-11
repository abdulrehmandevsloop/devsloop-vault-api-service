import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

export class BulkVariableUpdateItem {
  @ApiProperty({ description: 'CUID of the payroll line to update' })
  @IsString()
  lineId!: string;

  @ApiPropertyOptional({ description: 'Extra working days (overtime days at daily base rate)' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(31)
  extraWorkingDays?: number;

  @ApiPropertyOptional({ description: 'Performance bonus amount (PKR)' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  performanceBonus?: number;

  @ApiPropertyOptional({ description: 'Penalty / fine amount (PKR)' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  fines?: number;
}

export class BulkUpdateVariablesDto {
  @ApiProperty({
    type: [BulkVariableUpdateItem],
    description:
      'Absolute (overwrite) values per payroll line for performance bonus, extra working days and penalties.',
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(5000)
  @ValidateNested({ each: true })
  @Type(() => BulkVariableUpdateItem)
  updates!: BulkVariableUpdateItem[];
}
