export class ContributionRejectedEvent {
  constructor(
    public readonly contributionId: string,
    public readonly authorId: string,
    public readonly authorEmail: string,
    public readonly reviewerId: string,
    public readonly reviewerName: string,
    public readonly reviewerComment: string,
    public readonly timestamp: Date = new Date(),
  ) {}
}
