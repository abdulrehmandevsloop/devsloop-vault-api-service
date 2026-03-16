import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class LeaveTypeStatDto {
  @ApiProperty({ description: 'Leave type name' })
  leaveType: string;

  @ApiProperty({ description: 'Total requests of this type' })
  total: number;

  @ApiProperty({ description: 'Approved requests' })
  approved: number;

  @ApiProperty({ description: 'Rejected requests (both stages)' })
  rejected: number;

  @ApiProperty({ description: 'Pending requests' })
  pending: number;
}

export class HrStatsResponseDto {
  @ApiProperty({ description: 'Calendar year the stats cover' })
  year: number;

  @ApiPropertyOptional({ description: 'Department filter applied (if any)' })
  department: string | null;

  @ApiProperty({ description: 'Total leave requests in scope' })
  total: number;

  @ApiProperty({ description: 'Total currently pending (PENDING status)' })
  totalPending: number;

  @ApiProperty({ description: 'Total awaiting HR final decision (TEAM_LEAD_APPROVED)' })
  totalPendingHr: number;

  @ApiProperty({ description: 'Total fully approved' })
  totalApproved: number;

  @ApiProperty({ description: 'Total rejected (either stage)' })
  totalRejected: number;

  @ApiProperty({ description: 'Number of active employees absent today (on approved leave)' })
  todayAbsent: number;

  @ApiProperty({ description: 'Number of active employees present today' })
  todayPresent: number;

  @ApiProperty({ type: [LeaveTypeStatDto], description: 'Breakdown per leave type' })
  byLeaveType: LeaveTypeStatDto[];
}
