export class LeaveSubmittedEvent {
  constructor(
    public readonly leaveRequestId: string,
    public readonly employeeId: string,
    public readonly employeeEmail: string,
    public readonly employeeName: string,
    public readonly reportingManagerId: string,
    public readonly reportingManagerEmail: string,
    public readonly reportingManagerName: string,
    public readonly leaveType: string,
    public readonly startDate: Date,
    public readonly endDate: Date,
    public readonly daysConsumed: number,
    public readonly timestamp: Date = new Date(),
  ) {}
}
