import { LeaveStatus } from '@prisma/client';

export class LeaveTeamLeadReviewedEvent {
  constructor(
    public readonly leaveRequestId: string,
    public readonly employeeId: string,
    public readonly employeeEmail: string,
    public readonly employeeName: string,
    public readonly teamLeadId: string,
    public readonly teamLeadName: string,
    public readonly decision: LeaveStatus,
    public readonly comment: string,
    public readonly leaveType: string,
    public readonly startDate: Date,
    public readonly endDate: Date,
    public readonly requiresClientApproval: boolean = false,
    public readonly timestamp: Date = new Date(),
  ) {}
}
