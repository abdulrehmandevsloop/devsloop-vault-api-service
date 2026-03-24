import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { PgBossService } from 'src/queue/pg-boss.service';

@Injectable()
export class ReimbursementEmailHandler {
  constructor(private pgBossService: PgBossService) {}

  @OnEvent('reimbursement.created')
  async handleReimbursementCreated(payload: any) {
    await this.pgBossService.sendToQueue('email-notification', {
      to: payload.reimbursement.employee.email,
      subject: 'Reimbursement Request Submitted',
      template: 'reimbursement-created',
      data: {
        employeeName: payload.reimbursement.employee.name,
        requestId: payload.reimbursement.id,
        amount: payload.reimbursement.amount,
        type: payload.reimbursement.reimbursementType,
        description: payload.reimbursement.description,
      },
    });
  }

  @OnEvent('reimbursement.approved')
  async handleReimbursementApproved(payload: any) {
    // Notify employee
    await this.pgBossService.sendToQueue('email-notification', {
      to: payload.reimbursement.employee.email,
      subject: 'Reimbursement Request Approved',
      template: 'reimbursement-approved',
      data: {
        employeeName: payload.reimbursement.employee.name,
        requestId: payload.reimbursement.id,
        amount: payload.reimbursement.amount,
        type: payload.reimbursement.reimbursementType,
        processingType: payload.reimbursement.processingType,
        salaryMonth: payload.reimbursement.salaryMonth,
        hrComment: payload.reimbursement.hrComment,
      },
    });

    // Notify HR team
    await this.pgBossService.sendToQueue('email-notification', {
      to: 'hr@devsloop.com',
      subject: 'Reimbursement Request Approved',
      template: 'reimbursement-approved-hr',
      data: {
        employeeName: payload.reimbursement.employee.name,
        requestId: payload.reimbursement.id,
        amount: payload.reimbursement.amount,
        type: payload.reimbursement.reimbursementType,
        processingType: payload.reimbursement.processingType,
        hrName: payload.reimbursement.hrReviewer?.name,
      },
    });
  }

  @OnEvent('reimbursement.rejected')
  async handleReimbursementRejected(payload: any) {
    // Notify employee
    await this.pgBossService.sendToQueue('email-notification', {
      to: payload.reimbursement.employee.email,
      subject: 'Reimbursement Request Rejected',
      template: 'reimbursement-rejected',
      data: {
        employeeName: payload.reimbursement.employee.name,
        requestId: payload.reimbursement.id,
        amount: payload.reimbursement.amount,
        type: payload.reimbursement.reimbursementType,
        hrComment: payload.reimbursement.hrComment,
      },
    });

    // Notify HR team
    await this.pgBossService.sendToQueue('email-notification', {
      to: 'hr@devsloop.com',
      subject: 'Reimbursement Request Rejected',
      template: 'reimbursement-rejected-hr',
      data: {
        employeeName: payload.reimbursement.employee.name,
        requestId: payload.reimbursement.id,
        amount: payload.reimbursement.amount,
        type: payload.reimbursement.reimbursementType,
        hrName: payload.reimbursement.hrReviewer?.name,
        hrComment: payload.reimbursement.hrComment,
      },
    });
  }

  @OnEvent('reimbursement.processed')
  async handleReimbursementProcessed(payload: any) {
    // Notify employee
    await this.pgBossService.sendToQueue('email-notification', {
      to: payload.reimbursement.employee.email,
      subject: 'Reimbursement Request Processed',
      template: 'reimbursement-processed',
      data: {
        employeeName: payload.reimbursement.employee.name,
        requestId: payload.reimbursement.id,
        amount: payload.reimbursement.amount,
        type: payload.reimbursement.reimbursementType,
        processingType: payload.reimbursement.processingType,
        processingNotes: payload.reimbursement.processingNotes,
      },
    });

    // Notify finance team if separate payment
    if (payload.reimbursement.processingType === 'SEPARATE_PAYMENT') {
      await this.pgBossService.sendToQueue('email-notification', {
        to: 'finance@devsloop.com',
        subject: 'Reimbursement Ready for Payment',
        template: 'reimbursement-payment-reminder',
        data: {
          employeeName: payload.reimbursement.employee.name,
          requestId: payload.reimbursement.id,
          amount: payload.reimbursement.amount,
          type: payload.reimbursement.reimbursementType,
          bankName: payload.reimbursement.employee.bankName,
          iban: payload.reimbursement.employee.iban,
        },
      });
    }
  }
}
