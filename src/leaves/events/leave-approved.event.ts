import { LeaveCategory } from '@prisma/client';

export class LeaveApprovedEvent {
  constructor(
    public readonly leaveRequestId: string,
    public readonly employeeId: string,
    public readonly employeeEmail: string,
    public readonly employeeName: string,
    public readonly hrId: string,
    public readonly hrName: string,
    public readonly comment: string,
    public readonly leaveType: string,
    public readonly startDate: Date,
    public readonly endDate: Date,
    public readonly daysConsumed: number,
    public readonly convertedToWfh: boolean = false,
    public readonly originalLeaveType: string | null = null,
    public readonly category: LeaveCategory | null = null,
    public readonly timestamp: Date = new Date(),
  ) {}
}
