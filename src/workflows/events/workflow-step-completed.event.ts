export class WorkflowStepCompletedEvent {
  constructor(
    public readonly instanceId: string,
    public readonly requestType: string,
    public readonly requestId: string,
    public readonly requesterId: string,
    public readonly stepOrder: number,
    public readonly stepName: string,
    public readonly resolution: string,
    public readonly actorId: string | null,
    public readonly comment: string | null,
    public readonly timestamp: Date = new Date(),
  ) {}
}
