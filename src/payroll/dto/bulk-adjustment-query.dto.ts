import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsEnum, IsOptional } from 'class-validator';
import { Transform } from 'class-transformer';

export enum BulkConflictMode {
  OVERWRITE = 'OVERWRITE',
  ADD = 'ADD',
}

export class BulkAdjustmentQueryDto {
  @ApiPropertyOptional({ description: 'Preview without applying', default: true })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => value === 'true' || value === true)
  @IsBoolean()
  dryRun?: boolean = true;

  @ApiPropertyOptional({
    description: 'OVERWRITE replaces existing values; ADD adds to existing',
    enum: BulkConflictMode,
    default: BulkConflictMode.OVERWRITE,
  })
  @IsOptional()
  @IsEnum(BulkConflictMode)
  conflictMode?: BulkConflictMode = BulkConflictMode.OVERWRITE;
}
