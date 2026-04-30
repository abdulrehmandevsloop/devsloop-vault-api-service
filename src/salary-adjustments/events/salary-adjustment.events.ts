import { SalaryAdjustmentCategory, SalaryAdjustmentType } from '@prisma/client';

export class SalaryAdjustmentSubmittedEvent {
  constructor(
    public readonly adjustmentId: string,
    public readonly yearMonth: string,
    public readonly employeeName: string,
    public readonly submitterName: string,
    public readonly amount: number,
    public readonly category: SalaryAdjustmentCategory,
    public readonly type: SalaryAdjustmentType,
    public readonly authorizerEmail: string,
  ) {}
}

export class SalaryAdjustmentApprovedEvent {
  constructor(
    public readonly adjustmentId: string,
    public readonly yearMonth: string,
    public readonly employeeName: string,
    public readonly authorizerName: string,
    public readonly amount: number,
    public readonly submitterEmail: string,
  ) {}
}

export class SalaryAdjustmentRejectedEvent {
  constructor(
    public readonly adjustmentId: string,
    public readonly yearMonth: string,
    public readonly employeeName: string,
    public readonly authorizerName: string,
    public readonly comment: string | null,
    public readonly submitterEmail: string,
  ) {}
}
