export class LeaveModifiedEvent {
  constructor(
    public readonly leaveRequestId: string,
    public readonly employeeId: string,
    public readonly employeeEmail: string,
    public readonly employeeName: string,
    public readonly hrId: string,
    public readonly hrName: string,
    public readonly comment: string,
    /** Previous leave type before modification */
    public readonly previousLeaveType: string,
    /** New leave type after modification */
    public readonly newLeaveType: string,
    public readonly previousStartDate: Date,
    public readonly newStartDate: Date,
    public readonly previousEndDate: Date,
    public readonly newEndDate: Date,
    public readonly previousDaysConsumed: number,
    public readonly newDaysConsumed: number,
    public readonly previousStatus: string,
    public readonly newStatus: string,
    public readonly timestamp: Date = new Date(),
  ) {}
}
