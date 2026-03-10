import { ApiProperty } from '@nestjs/swagger';
import { LeaveRequestResponseDto } from './leave-request-response.dto';

export class PaginatedLeavesResponseDto {
  @ApiProperty({ type: [LeaveRequestResponseDto] })
  data: LeaveRequestResponseDto[];

  @ApiProperty() total: number;
  @ApiProperty() page: number;
  @ApiProperty() limit: number;
  @ApiProperty() totalPages: number;
  @ApiProperty() hasNextPage: boolean;
  @ApiProperty() hasPreviousPage: boolean;

  @ApiProperty({
    description:
      'Count of PENDING requests in this scoped view (ignores per-tab status filter but respects role and other filters)',
  })
  pending: number;

  @ApiProperty({
    description:
      'Count of TEAM_LEAD_APPROVED requests in this scoped view (ignores per-tab status filter but respects role and other filters)',
  })
  teamLeadApproved: number;

  @ApiProperty({
    description:
      'Count of APPROVED requests in this scoped view (ignores per-tab status filter but respects role and other filters)',
  })
  approved: number;

  @ApiProperty({
    description:
      'Total approved leave-days in this scoped view (sum of daysConsumed for APPROVED requests excluding WFH)',
    example: 7.5,
  })
  approvedLeaveDays: number;

  @ApiProperty({
    description:
      'Count of TEAM_LEAD_REJECTED + REJECTED requests in this scoped view (ignores per-tab status filter but respects role and other filters)',
  })
  rejected: number;

  @ApiProperty({
    description:
      'Count of CANCELLED requests in this scoped view (ignores per-tab status filter but respects role and other filters)',
  })
  cancelled: number;
}
