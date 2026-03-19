export class LeaveDeletedEvent {
  constructor(
    public readonly leaveRequestId: string,
    public readonly employeeId: string,
    public readonly employeeName: string,
    public readonly hrId: string,
    public readonly leaveType: string,
    public readonly status: string,
    public readonly startDate: Date,
    public readonly endDate: Date,
    public readonly daysConsumed: number,
    public readonly balanceReversed: boolean,
    public readonly timestamp: Date = new Date(),
  ) {}
}
