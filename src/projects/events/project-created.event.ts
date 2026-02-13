export class ProjectCreatedEvent {
  constructor(
    public readonly projectId: string,
    public readonly projectName: string,
    public readonly adminId: string,
    public readonly clientName: string,
    public readonly domain: string,
    public readonly timestamp: Date = new Date(),
  ) {}
}
