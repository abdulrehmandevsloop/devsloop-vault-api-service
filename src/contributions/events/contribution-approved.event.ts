export class ContributionApprovedEvent {
  constructor(
    public readonly contributionId: string,
    public readonly userId: string,
    public readonly userEmail: string,
    public readonly reviewerId: string,
    public readonly reviewerName: string,
    public readonly projectId: string,
    public readonly timestamp: Date = new Date(),
  ) {}
}
