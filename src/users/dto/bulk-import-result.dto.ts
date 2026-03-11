import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class BulkImportRowResultDto {
  @ApiProperty({ description: 'Row number in the file (1-based, excluding header)', example: 1 })
  row: number;

  @ApiProperty({ description: 'Employee name from the row', example: 'John Doe' })
  name: string;

  @ApiProperty({ description: 'Company email from the row', example: 'john.doe@company.com' })
  email: string;

  @ApiProperty({ description: 'Whether this row was imported successfully', example: true })
  success: boolean;

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

  @ApiProperty({ description: 'Number of successfully imported rows', example: 8 })
  succeeded: number;

  @ApiProperty({ description: 'Number of failed rows', example: 2 })
  failed: number;

  @ApiProperty({
    description: 'Per-row results',
    type: [BulkImportRowResultDto],
  })
  results: BulkImportRowResultDto[];
}
