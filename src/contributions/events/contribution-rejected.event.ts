export class ContributionRejectedEvent {
  constructor(
    public readonly contributionId: string,
    public readonly userId: string,
    public readonly userEmail: string,
    public readonly reviewerId: string,
    public readonly reviewerName: string,
    public readonly reviewComments: string,
    public readonly timestamp: Date = new Date(),
  ) {}
}
