import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class BulkImportRowResultDto {
  @ApiProperty({ description: 'Row number in the file (1-based, excluding header)', example: 1 })
  row: number;

  @ApiProperty({ description: 'Employee name from the row', example: 'John Doe' })
  name: string;

  @ApiProperty({ description: 'Company email from the row', example: 'john.doe@company.com' })
  email: string;

  @ApiProperty({ description: 'Whether this row was processed successfully', example: true })
  success: boolean;

  @ApiPropertyOptional({
    description: 'True when the email already existed and was updated in place',
    example: false,
  })
  updated?: boolean;

  @ApiPropertyOptional({
    description:
      'True when skipExisting=true and the email already existed — row was intentionally skipped',
    example: false,
  })
  skipped?: boolean;

  @ApiPropertyOptional({
    description: 'Validation or processing errors for this row',
    example: ['Email already exists', 'Invalid department'],
    type: [String],
  })
  errors?: string[];
}

export class BulkImportResultDto {
  @ApiProperty({ description: 'Total number of data rows processed', example: 10 })
  total: number;

  @ApiProperty({
    description: 'Number of successfully processed rows (created + updated)',
    example: 8,
  })
  succeeded: number;

  @ApiProperty({ description: 'Number of newly created employee records', example: 6 })
  created: number;

  @ApiProperty({ description: 'Number of existing employee records updated', example: 2 })
  updated: number;

  @ApiProperty({
    description: 'Number of rows skipped because the email already existed',
    example: 0,
  })
  skipped: number;

  @ApiProperty({ description: 'Number of failed rows', example: 2 })
  failed: number;

  @ApiProperty({ description: 'Per-row results', type: [BulkImportRowResultDto] })
  results: BulkImportRowResultDto[];
}
