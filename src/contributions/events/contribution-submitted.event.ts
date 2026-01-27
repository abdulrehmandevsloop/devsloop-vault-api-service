export class ContributionSubmittedEvent {
  constructor(
    public readonly contributionId: string,
    public readonly userId: string,
    public readonly userEmail: string,
    public readonly projectId: string,
    public readonly projectName: string,
    public readonly timestamp: Date = new Date(),
  ) {}
}
