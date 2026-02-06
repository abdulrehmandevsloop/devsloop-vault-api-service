export class ContributionApprovedEvent {
  constructor(
    public readonly contributionId: string,
    public readonly authorId: string,
    public readonly authorEmail: string,
    public readonly reviewerId: string,
    public readonly reviewerName: string,
    public readonly projectId: string,
    public readonly reviewerComment?: string | null,
    public readonly timestamp: Date = new Date(),
  ) {}
}
