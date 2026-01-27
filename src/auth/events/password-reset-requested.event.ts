export class PasswordResetRequestedEvent {
  constructor(
    public readonly email: string,
    public readonly token: string,
    public readonly resetUrl: string,
    public readonly timestamp: Date = new Date(),
  ) {}
}
