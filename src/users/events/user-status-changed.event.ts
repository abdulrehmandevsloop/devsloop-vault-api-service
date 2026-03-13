export class UserStatusChangedEvent {
  constructor(
    public readonly userId: string,
    public readonly email: string,
    public readonly name: string,
    public readonly previousStatus: string,
    public readonly newStatus: string,
    public readonly adminId: string,
  ) {}
}
