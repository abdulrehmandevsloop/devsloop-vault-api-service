import { ApprovalStatus } from '@prisma/client';

export class UserApprovedEvent {
  constructor(
    public readonly userId: string,
    public readonly email: string,
    public readonly name: string,
    public readonly approvedBy: string,
    public readonly previousStatus: ApprovalStatus,
    public readonly newStatus: ApprovalStatus,
    public readonly timestamp: Date = new Date(),
  ) {}
}
