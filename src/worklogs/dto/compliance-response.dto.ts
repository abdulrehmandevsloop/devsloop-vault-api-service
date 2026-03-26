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
  leaveDays: number;

  @ApiProperty({ description: 'Work submissions on Saturdays (bonus)' })
  saturdayDays: number;

  @ApiProperty({ description: 'Work submissions on Sundays (bonus)' })
  sundayDays: number;

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

export class WorklogExportEntryDto {
  @ApiProperty({ description: 'Date in YYYY-MM-DD format', example: '2026-02-01' })
  date: string;

  @ApiProperty({ description: 'HTML content of the worklog entry' })
  content: string;

  @ApiProperty({ description: 'Man day value (0 for leave, 1 for normal)' })
  manDay: number;

  @ApiProperty({ description: 'Whether this is a leave entry' })
  isLeave: boolean;
}

export class UserWorklogExportDto {
  @ApiProperty()
  userId: string;

  @ApiProperty()
  name: string;

  @ApiPropertyOptional({ nullable: true, description: 'User designation/role (e.g. Backend, QA)' })
  designation: string | null;

  @ApiProperty({ description: 'Total man days logged in the month' })
  totalManDays: number;

  @ApiProperty({ description: 'Total leave entries in the month' })
  totalLeaves: number;

  @ApiProperty({ type: [WorklogExportEntryDto] })
  entries: WorklogExportEntryDto[];
}

export class ProjectWorklogExportResponseDto {
  @ApiProperty()
  projectName: string;

  @ApiProperty()
  clientName: string;

  @ApiProperty({ example: '2026-02' })
  month: string;

  @ApiProperty({ type: [UserWorklogExportDto] })
  users: UserWorklogExportDto[];
}
