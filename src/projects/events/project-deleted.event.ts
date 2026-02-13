export class ProjectDeletedEvent {
  constructor(
    public readonly projectId: string,
    public readonly projectName: string,
    public readonly adminId: string,
    public readonly timestamp: Date = new Date(),
  ) {}
}
