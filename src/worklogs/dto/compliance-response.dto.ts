import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ComplianceSummaryDto {
  @ApiProperty({ description: 'Total Mon–Fri working days in month up to yesterday' })
  totalWorkingDays: number;

  @ApiProperty({ description: 'Days with a submitted worklog' })
  submittedDays: number;

  @ApiProperty({ description: 'Working days with no submission (missed)' })
  missedDays: number;

  @ApiProperty({ description: 'Compliance percentage 0–100', example: 90 })
  compliancePct: number;
}

export class ProjectUserComplianceDto {
  @ApiProperty()
  userId: string;

  @ApiProperty()
  name: string;

  @ApiProperty()
  email: string;

  @ApiPropertyOptional({ nullable: true })
  avatarUrl: string | null;

  @ApiProperty()
  totalWorkingDays: number;

  @ApiProperty()
  submittedDays: number;

  @ApiProperty()
  missedDays: number;

  @ApiProperty()
  compliancePct: number;
}

export class ProjectComplianceResponseDto {
  @ApiProperty()
  month: string;

  @ApiProperty()
  projectId: string;

  @ApiProperty({ type: [ProjectUserComplianceDto] })
  users: ProjectUserComplianceDto[];

  @ApiProperty()
  total: number;

  @ApiProperty()
  page: number;

  @ApiProperty()
  limit: number;

  @ApiProperty()
  totalPages: number;
}

export class ExportWorklogResponseDto {
  @ApiProperty({ description: 'CSV content as string' })
  csv: string;

  @ApiProperty({
    description: 'Suggested filename for download',
    example: 'worklog-ali-2025-02.csv',
  })
  filename: string;
}
