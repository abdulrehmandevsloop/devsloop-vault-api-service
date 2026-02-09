export class UserRolesChangedEvent {
  constructor(
    public readonly userId: string,
    public readonly email: string,
    public readonly name: string,
    public readonly changedBy: string,
    public readonly changedByName: string,
    public readonly addedRoleNames: string[],
    public readonly removedRoleNames: string[],
    public readonly currentRoleNames: string[],
    public readonly timestamp: Date = new Date(),
  ) {}
}
