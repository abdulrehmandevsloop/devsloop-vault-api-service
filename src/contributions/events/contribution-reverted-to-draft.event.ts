import { ContributionStatus } from '@prisma/client';

export class ContributionRevertedToDraftEvent {
  constructor(
    public readonly contributionId: string,
    public readonly authorId: string,
    public readonly fromStatus: ContributionStatus,
    public readonly toStatus: ContributionStatus,
    public readonly timestamp: Date = new Date(),
  ) {}
}
