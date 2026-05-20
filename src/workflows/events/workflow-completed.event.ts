export class WorkflowCompletedEvent {
  constructor(
    public readonly instanceId: string,
    public readonly requestType: string,
    public readonly requestId: string,
    public readonly requesterId: string,
    public readonly resolution: 'APPROVED' | 'REJECTED' | 'CANCELLED',
    public readonly reason: string | null = null,
    public readonly timestamp: Date = new Date(),
  ) {}
}
