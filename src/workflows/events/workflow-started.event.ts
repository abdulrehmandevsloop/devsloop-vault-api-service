export class WorkflowStartedEvent {
  constructor(
    public readonly instanceId: string,
    public readonly requestType: string,
    public readonly requestId: string,
    public readonly requesterId: string,
    public readonly timestamp: Date = new Date(),
  ) {}
}
