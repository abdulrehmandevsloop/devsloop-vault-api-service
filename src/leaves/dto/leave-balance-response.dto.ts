import { ApiProperty } from '@nestjs/swagger';

export class LeaveBalanceResponseDto {
  @ApiProperty({ description: 'Balance record ID' })
  id: string;

  @ApiProperty({ description: 'User ID' })
  userId: string;

  @ApiProperty({ description: 'Calendar year' })
  year: number;

  @ApiProperty({ description: 'Total casual leave quota for the year (pro-rated for new joiners)' })
  casualBalance: number;

  @ApiProperty({ description: 'Casual leave days used so far (approved leaves)' })
  casualUsed: number;

  @ApiProperty({ description: 'Casual leave days remaining' })
  casualRemaining: number;

  @ApiProperty({ description: 'Total sick leave quota for the year (pro-rated)' })
  sickBalance: number;

  @ApiProperty({ description: 'Sick leave days used so far' })
  sickUsed: number;

  @ApiProperty({ description: 'Sick leave days remaining' })
  sickRemaining: number;

  @ApiProperty({
    description: 'Casual leave days used beyond the yearly entitlement (negative balance)',
    required: false,
  })
  casualOverdrawn?: number;

  @ApiProperty({
    description: 'Sick leave days used beyond the yearly entitlement (negative balance)',
    required: false,
  })
  sickOverdrawn?: number;

  @ApiProperty({ description: 'Number of half-day leaves taken this year (deducted from casual)' })
  halfDayUsed: number;

  @ApiProperty({ description: 'WFH days approved (truly taken) in the current month' })
  wfhUsedThisMonth: number;

  @ApiProperty({
    description: 'WFH requests in pending / team-lead-approved state for the current month',
  })
  wfhPendingThisMonth: number;

  @ApiProperty({
    description:
      'WFH days remaining in the current month based on the per-employee monthly allowance',
  })
  wfhRemainingThisMonth: number;

  @ApiProperty({
    description: 'WFH allowance per month for this employee (days per calendar month)',
    required: false,
  })
  wfhAllowancePerMonth?: number;

  @ApiProperty({
    description:
      'WFH days used beyond the monthly allowance in the current month (negative balance)',
    required: false,
  })
  wfhOverdrawnThisMonth?: number;
}
