export class ContributionUpdatedEvent {
  constructor(
    public readonly contributionId: string,
    public readonly authorId: string,
    public readonly changedFields: string[],
    public readonly projectId?: string,
    public readonly visibility?: string,
    public readonly timestamp: Date = new Date(),
  ) {}
}
