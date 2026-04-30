import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

// ── Query DTOs ────────────────────────────────────────────────────────────────

export class MonthlyReportQueryDto {
  @ApiProperty({ example: 2026 })
  @Type(() => Number)
  @IsInt({ message: 'Year must be an integer' })
  @Min(2020, { message: 'Year must be 2020 or later' })
  @Max(2100, { message: 'Year must be 2100 or earlier' })
  year: number;

  @ApiProperty({ example: 4 })
  @Type(() => Number)
  @IsInt({ message: 'Month must be an integer' })
  @Min(1, { message: 'Month must be between 1 and 12' })
  @Max(12, { message: 'Month must be between 1 and 12' })
  month: number;
}

export class ComparisonQueryDto {
  @ApiPropertyOptional({ example: 6, default: 6 })
  @Type(() => Number)
  @IsOptional()
  @IsInt({ message: 'Months must be an integer' })
  @Min(2, { message: 'Months must be at least 2' })
  @Max(24, { message: 'Months can be up to 24' })
  months?: number = 6;
}

export class ExportQueryDto {
  @ApiProperty({ example: 2026 })
  @Type(() => Number)
  @IsInt({ message: 'Year must be an integer' })
  @Min(2020, { message: 'Year must be 2020 or later' })
  @Max(2100, { message: 'Year must be 2100 or earlier' })
  year: number;

  @ApiProperty({ example: 4 })
  @Type(() => Number)
  @IsInt({ message: 'Month must be an integer' })
  @Min(1, { message: 'Month must be between 1 and 12' })
  @Max(12, { message: 'Month must be between 1 and 12' })
  month: number;
}

// ── Response DTOs ─────────────────────────────────────────────────────────────

export class CategoryBreakdownDto {
  @ApiProperty() category: string;
  @ApiProperty({ example: '30000.00' }) amount: string;
  @ApiProperty() count: number;
}

export class StatusSplitDto {
  @ApiProperty({ example: '20000.00' }) amount: string;
  @ApiProperty() count: number;
}

export class MonthlyReportResponseDto {
  @ApiProperty() year: number;
  @ApiProperty() month: number;
  @ApiProperty({ example: 'Apr 2026' }) label: string;
  @ApiProperty({ example: '75000.00' }) total: string;
  @ApiProperty() count: number;
  @ApiProperty({ type: StatusSplitDto }) draft: StatusSplitDto;
  @ApiProperty({ type: StatusSplitDto }) recorded: StatusSplitDto;
  @ApiProperty({ type: [CategoryBreakdownDto] }) byCategory: CategoryBreakdownDto[];
}

export class MonthSlotDto {
  @ApiProperty() year: number;
  @ApiProperty() month: number;
  @ApiProperty({ example: 'Apr 2026' }) label: string;
  @ApiProperty({ example: '75000.00' }) total: string;
  @ApiProperty() count: number;
  @ApiProperty({ example: '20000.00' }) draft: string;
  @ApiProperty({ example: '55000.00' }) recorded: string;
  @ApiPropertyOptional({ nullable: true, example: 12.5 }) changePercent: number | null;
}

export class MonthlyComparisonResponseDto {
  @ApiProperty({ type: [MonthSlotDto] }) months: MonthSlotDto[];
}
