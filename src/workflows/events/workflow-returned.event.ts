export class WorkflowReturnedEvent {
  constructor(
    public readonly instanceId: string,
    public readonly requestType: string,
    public readonly requestId: string,
    public readonly requesterId: string,
    public readonly returnedFromStep: number,
    public readonly returnToStep: number,
    public readonly returnCount: number,
    public readonly actorId: string,
    public readonly comment: string | null,
    public readonly timestamp: Date = new Date(),
  ) {}
}
