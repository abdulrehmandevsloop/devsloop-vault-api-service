import { ContributionStatus } from '@prisma/client';

export class ContributionDeletedEvent {
  constructor(
    public readonly contributionId: string,
    public readonly authorId: string,
    public readonly status: ContributionStatus,
    public readonly timestamp: Date = new Date(),
  ) {}
}
