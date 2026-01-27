export class UserRejectedEvent {
  constructor(
    public readonly userId: string,
    public readonly email: string,
    public readonly name: string,
    public readonly rejectedBy: string,
    public readonly reason: string,
    public readonly timestamp: Date = new Date(),
  ) {}
}
