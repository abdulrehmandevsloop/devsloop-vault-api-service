export class ProjectUpdatedEvent {
  constructor(
    public readonly projectId: string,
    public readonly projectName: string,
    public readonly adminId: string,
    public readonly changedFields: string[],
    public readonly timestamp: Date = new Date(),
  ) {}
}
