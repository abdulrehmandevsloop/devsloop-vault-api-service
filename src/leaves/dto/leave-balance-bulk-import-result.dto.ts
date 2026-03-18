import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class LeaveBalanceBulkImportRowResultDto {
  @ApiProperty({ description: '1-based row number in the uploaded file', example: 1 })
  row: number;

  @ApiProperty({
    description: 'Human-readable identifier for the row',
    example: 'ahmed@company.com / 2025',
  })
  identifier: string;

  @ApiProperty({ description: 'Whether the row was processed without errors' })
  success: boolean;

  @ApiPropertyOptional({
    description: 'True when the record was skipped because it already exists and skipExisting=true',
  })
  skipped?: boolean;

  @ApiPropertyOptional({
    type: [String],
    description: 'Validation or database errors for this row',
  })
  errors?: string[];
}

export class LeaveBalanceBulkImportResultDto {
  @ApiProperty({ description: 'Total number of data rows in the file' })
  total: number;

  @ApiProperty({ description: 'Number of rows successfully upserted' })
  succeeded: number;

  @ApiProperty({ description: 'Number of rows skipped (already existed)' })
  skipped: number;

  @ApiProperty({ description: 'Number of rows that failed validation or DB write' })
  failed: number;

  @ApiProperty({ type: [LeaveBalanceBulkImportRowResultDto] })
  results: LeaveBalanceBulkImportRowResultDto[];
}
