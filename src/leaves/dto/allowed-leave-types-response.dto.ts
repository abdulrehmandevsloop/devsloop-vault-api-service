import { ApiProperty } from '@nestjs/swagger';
import { LeaveType } from '@prisma/client';

export class AllowedLeaveTypesResponseDto {
  @ApiProperty({
    type: [String],
    enum: LeaveType,
    description: 'Leave types this employee may request',
  })
  allowedTypes: LeaveType[];

  @ApiProperty({ description: 'Whether Maternity leave is enabled for this employee' })
  allowMaternityLeave: boolean;

  @ApiProperty({ description: 'Whether Wedding leave is enabled for this employee' })
  allowWeddingLeave: boolean;

  @ApiProperty({ description: 'Whether Umrah/Hajj leave is enabled for this employee' })
  allowUmrahHajjLeave: boolean;

  @ApiProperty({ description: 'Whether Other leave is enabled for this employee' })
  allowOtherLeave: boolean;

  @ApiProperty({ description: 'Whether employee is exempt from the monthly WFH cap (HR override)' })
  allowExtraWfh: boolean;
}
