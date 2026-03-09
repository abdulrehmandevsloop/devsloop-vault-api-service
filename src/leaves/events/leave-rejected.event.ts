export class LeaveRejectedEvent {
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
    public readonly timestamp: Date = new Date(),
  ) {}
}
