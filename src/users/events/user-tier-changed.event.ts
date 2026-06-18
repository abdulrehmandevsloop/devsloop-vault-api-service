import { UserTier } from '@prisma/client';

export class UserTierChangedEvent {
  constructor(
    public readonly userId: string,
    public readonly email: string,
    public readonly name: string,
    public readonly oldTier: UserTier | null,
    public readonly newTier: UserTier | null,
    public readonly changedBy: string,
    public readonly timestamp: Date,
  ) {}
}
