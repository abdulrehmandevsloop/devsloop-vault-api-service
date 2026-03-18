import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { HalfDayPeriod, LeaveCategory, LeaveStatus, LeaveType } from '@prisma/client';

export class EmployeeSummaryDto {
  @ApiProperty() id: string;
  @ApiProperty() name: string;
  @ApiProperty() email: string;
  @ApiPropertyOptional() avatarUrl: string | null;
  @ApiProperty({ type: [String] }) departments: string[];
  @ApiPropertyOptional() designation: string | null;
}

export class ReviewerSummaryDto {
  @ApiProperty() id: string;
  @ApiProperty() name: string;
  @ApiProperty() email: string;
}

export class LeaveRequestResponseDto {
  @ApiProperty({ description: 'Leave request ID' })
  id: string;

  @ApiProperty({ description: 'Employee (submitter) ID' })
  employeeId: string;

  @ApiProperty({ description: 'Reporting manager ID' })
  reportingManagerId: string;

  @ApiProperty({ enum: LeaveType })
  leaveType: LeaveType;

  @ApiProperty({ enum: LeaveStatus })
  status: LeaveStatus;

  @ApiProperty({ description: 'Start date (ISO 8601)' })
  startDate: string;

  @ApiProperty({ description: 'End date (ISO 8601)' })
  endDate: string;

  @ApiPropertyOptional({ enum: HalfDayPeriod })
  halfDayPeriod: HalfDayPeriod | null;

  @ApiProperty({ description: 'Number of leave days consumed (0 for WFH, 0.5 for half-day)' })
  daysConsumed: number;

  @ApiProperty()
  reason: string;

  @ApiPropertyOptional()
  medicalCertificateUrl: string | null;

  @ApiPropertyOptional({ description: 'Team lead review comment (hidden from employee view)' })
  teamLeadComment: string | null;

  @ApiPropertyOptional({ description: 'When team lead reviewed (ISO 8601)' })
  teamLeadReviewedAt: string | null;

  @ApiPropertyOptional({
    description: 'Marks that the leave must be communicated to the client',
  })
  requiresClientApproval: boolean;

  @ApiPropertyOptional({ description: 'HR review comment' })
  hrComment: string | null;

  @ApiPropertyOptional({ description: 'When HR reviewed (ISO 8601)' })
  hrReviewedAt: string | null;

  @ApiPropertyOptional({
    enum: LeaveCategory,
    description: 'PAID or UNPAID — set on HR approval, null until then',
  })
  category: LeaveCategory | null;

  @ApiPropertyOptional({ description: 'Days treated as unpaid; 0 when fully paid' })
  unpaidDays: number;

  @ApiPropertyOptional({
    enum: LeaveType,
    description: 'Original leave type before HR converted it to WFH; null for all other leaves',
  })
  originalLeaveType: LeaveType | null;

  @ApiProperty({ description: 'Submission timestamp (ISO 8601)' })
  createdAt: string;

  @ApiProperty({ description: 'Last updated timestamp (ISO 8601)' })
  updatedAt: string;

  @ApiProperty({ type: EmployeeSummaryDto })
  employee: EmployeeSummaryDto;

  @ApiProperty({ type: ReviewerSummaryDto, description: 'Assigned reporting manager' })
  reportingManager: ReviewerSummaryDto;

  @ApiPropertyOptional({
    type: ReviewerSummaryDto,
    description: 'Team lead who reviewed (stage 1)',
  })
  teamLead: ReviewerSummaryDto | null;

  @ApiPropertyOptional({ type: ReviewerSummaryDto, description: 'HR who reviewed (stage 2)' })
  hr: ReviewerSummaryDto | null;
}
