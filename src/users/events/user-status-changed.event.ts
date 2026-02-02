export class UserStatusChangedEvent {
  constructor(
    public readonly userId: string,
    public readonly email: string,
    public readonly name: string,
    public readonly previousStatus: number, // 1 = has access, 0 = no access
    public readonly newStatus: number, // 1 = has access, 0 = no access
    public readonly adminId: string,
  ) {}
}
