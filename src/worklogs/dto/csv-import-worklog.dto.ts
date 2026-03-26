import { ApiProperty } from '@nestjs/swagger';

export class WorklogCsvRowResultDto {
  @ApiProperty() row: number;
  @ApiProperty() date: string;
  @ApiProperty() success: boolean;
  @ApiProperty({ required: false }) skipped?: boolean;
  @ApiProperty({ required: false }) overwritten?: boolean;
  @ApiProperty({ required: false, type: [String] }) errors?: string[];
  @ApiProperty({ required: false, type: [String] }) warnings?: string[];
}

export class WorklogCsvImportResultDto {
  @ApiProperty() total: number;
  @ApiProperty() succeeded: number;
  @ApiProperty() skipped: number;
  @ApiProperty() failed: number;
  @ApiProperty({ type: [WorklogCsvRowResultDto] }) results: WorklogCsvRowResultDto[];
}
