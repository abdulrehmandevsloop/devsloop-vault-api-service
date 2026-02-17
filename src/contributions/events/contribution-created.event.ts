export class ContributionCreatedEvent {
  constructor(
    public readonly contributionId: string,
    public readonly authorId: string,
    public readonly projectId: string,
    public readonly projectName: string,
    public readonly timestamp: Date = new Date(),
  ) {}
}
