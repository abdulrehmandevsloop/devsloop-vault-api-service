export class VerificationEmailRequestedEvent {
  constructor(
    public readonly userId: string,
    public readonly email: string,
    public readonly name: string,
    public readonly isResend: boolean = false,
    public readonly timestamp: Date = new Date(),
  ) {}
}
