export class ContributionSubmittedEvent {
  constructor(
    public readonly contributionId: string,
    public readonly authorId: string,
    public readonly authorEmail: string,
    public readonly projectId: string,
    public readonly projectName: string,
    public readonly timestamp: Date = new Date(),
  ) {}
}
