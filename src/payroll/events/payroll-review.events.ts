export class PayrollSubmittedForReviewEvent {
  readonly periodId: string;
  readonly yearMonth: string;
  readonly submitterId: string;
  readonly submitterName: string;
  readonly submitterEmail: string;
  readonly authorizerId: string;
  readonly authorizerEmail: string;
  readonly authorizerName: string;

  constructor(data: PayrollSubmittedForReviewEvent) {
    Object.assign(this, data);
  }
}

export class PayrollAuthorizedEvent {
  readonly periodId: string;
  readonly yearMonth: string;
  readonly authorizerId: string;
  readonly authorizerName: string;
  readonly submitterEmail: string;
  readonly submitterName: string;

  constructor(data: PayrollAuthorizedEvent) {
    Object.assign(this, data);
  }
}

export class PayrollReviewRejectedEvent {
  readonly periodId: string;
  readonly yearMonth: string;
  readonly rejectorId: string;
  readonly rejectorName: string;
  readonly submitterId: string;
  readonly submitterEmail: string;
  readonly submitterName: string;
  readonly comment?: string;

  constructor(data: PayrollReviewRejectedEvent) {
    Object.assign(this, data);
  }
}

export class PayrollRecalledFromReviewEvent {
  readonly periodId: string;
  readonly yearMonth: string;
  readonly submitterId: string;
  readonly submitterName: string;
  readonly submitterEmail: string;
  readonly authorizerId: string;
  readonly authorizerEmail: string;
  readonly tempAuthorizerEmail: string | null;

  constructor(data: PayrollRecalledFromReviewEvent) {
    Object.assign(this, data);
  }
}

export class PayrollAuthorizationRevokedEvent {
  readonly periodId: string;
  readonly yearMonth: string;
  readonly actorId: string;
  readonly actorName: string;
  readonly submitterEmail: string;
  readonly submitterName: string;

  constructor(data: PayrollAuthorizationRevokedEvent) {
    Object.assign(this, data);
  }
}

export class PayrollTempAuthorizerDesignatedEvent {
  readonly periodId: string;
  readonly yearMonth: string;
  readonly actorId: string;
  readonly tempAuthorizerId: string;

  constructor(data: PayrollTempAuthorizerDesignatedEvent) {
    Object.assign(this, data);
  }
}

export class PayrollLineDeletedEvent {
  readonly periodId: string;
  readonly yearMonth: string;
  readonly lineId: string;
  readonly actorId: string;
  readonly employeeUserId: string;
  readonly displayName: string;

  constructor(data: PayrollLineDeletedEvent) {
    Object.assign(this, data);
  }
}
