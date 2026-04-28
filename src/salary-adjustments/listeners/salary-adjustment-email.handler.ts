import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { getFrontendUrl } from '../../common/utils/frontend-url';
import { PgBossService } from '../../queue/pg-boss.service';
import {
  SalaryAdjustmentSubmittedEvent,
  SalaryAdjustmentApprovedEvent,
  SalaryAdjustmentRejectedEvent,
} from '../events/salary-adjustment.events';

function shell(title: string, body: string): string {
  return `
<!DOCTYPE html>
<html><head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%"><tr><td align="center" style="padding:32px 16px;">
    <table width="560" style="background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.1);">
      <tr><td style="background:linear-gradient(135deg,#6366f1,#8b5cf6);padding:28px 32px;">
        <h1 style="margin:0;color:#fff;font-size:20px;font-weight:700;">${title}</h1></td></tr>
      <tr><td style="padding:28px 32px;">${body}</td></tr>
      <tr><td style="padding:16px 32px;background:#f8fafc;border-top:1px solid #e2e8f0;">
        <p style="margin:0;font-size:12px;color:#94a3b8;text-align:center;">DevsLoop Vault — Payroll</p>
      </td></tr>
    </table>
  </td></tr></table>
</body></html>`;
}

@Injectable()
export class SalaryAdjustmentEmailHandler {
  private readonly logger = new Logger(SalaryAdjustmentEmailHandler.name);

  constructor(private readonly pgBoss: PgBossService) {}

  @OnEvent('salary-adjustment.submitted', { async: true })
  async onSubmitted(event: SalaryAdjustmentSubmittedEvent): Promise<void> {
    const url = `${getFrontendUrl()}/payroll/adjustments`;
    const body = `
      <p style="font-size:15px;color:#334155;line-height:1.6;">
        A new salary adjustment for <strong>${event.employeeName}</strong> (${event.yearMonth}) is awaiting your review.
      </p>
      <ul style="font-size:14px;color:#475569;line-height:1.7;">
        <li><strong>Category:</strong> ${event.category}</li>
        <li><strong>Type:</strong> ${event.type}</li>
        <li><strong>Amount:</strong> PKR ${event.amount.toLocaleString()}</li>
        <li><strong>Submitted by:</strong> ${event.submitterName}</li>
      </ul>
      <p style="text-align:center;margin-top:24px;">
        <a href="${url}" style="display:inline-block;padding:12px 24px;background:#6366f1;color:#fff;text-decoration:none;border-radius:8px;font-weight:600;">Review Adjustment</a>
      </p>
    `;
    await this.pgBoss.sendToQueue('email-notification', {
      to: event.authorizerEmail,
      subject: `Salary Adjustment Pending — ${event.employeeName} (${event.yearMonth})`,
      html: shell('Salary Adjustment Pending', body),
      text: `Salary adjustment for ${event.employeeName} (${event.yearMonth}) requires your review. Amount: PKR ${event.amount}. Open: ${url}`,
    });
    this.logger.log(`Submitted notification sent to ${event.authorizerEmail}`);
  }

  @OnEvent('salary-adjustment.approved', { async: true })
  async onApproved(event: SalaryAdjustmentApprovedEvent): Promise<void> {
    const url = `${getFrontendUrl()}/payroll/adjustments`;
    const body = `
      <p style="font-size:15px;color:#334155;line-height:1.6;">
        The salary adjustment for <strong>${event.employeeName}</strong> (${event.yearMonth}) has been
        <strong style="color:#16a34a;">approved</strong> by ${event.authorizerName}.
      </p>
      <p style="font-size:14px;color:#475569;">Amount: PKR ${event.amount.toLocaleString()}</p>
      <p style="text-align:center;margin-top:24px;">
        <a href="${url}" style="display:inline-block;padding:12px 24px;background:#16a34a;color:#fff;text-decoration:none;border-radius:8px;font-weight:600;">View in Payroll</a>
      </p>
    `;
    await this.pgBoss.sendToQueue('email-notification', {
      to: event.submitterEmail,
      subject: `Salary Adjustment Approved — ${event.employeeName} (${event.yearMonth})`,
      html: shell('Adjustment Approved', body),
      text: `Salary adjustment for ${event.employeeName} (${event.yearMonth}) has been approved by ${event.authorizerName}.`,
    });
  }

  @OnEvent('salary-adjustment.rejected', { async: true })
  async onRejected(event: SalaryAdjustmentRejectedEvent): Promise<void> {
    const note = event.comment
      ? `<p style="background:#fef3c7;padding:12px 16px;border-radius:8px;font-size:14px;color:#92400e;"><strong>Reason:</strong><br/>${event.comment}</p>`
      : '';
    const body = `
      <p style="font-size:15px;color:#334155;line-height:1.6;">
        The salary adjustment for <strong>${event.employeeName}</strong> (${event.yearMonth}) was
        <strong style="color:#dc2626;">rejected</strong> by ${event.authorizerName}.
      </p>
      ${note}
    `;
    await this.pgBoss.sendToQueue('email-notification', {
      to: event.submitterEmail,
      subject: `Salary Adjustment Rejected — ${event.employeeName} (${event.yearMonth})`,
      html: shell('Adjustment Rejected', body),
      text: `Salary adjustment for ${event.employeeName} (${event.yearMonth}) was rejected by ${event.authorizerName}.${event.comment ? ' Reason: ' + event.comment : ''}`,
    });
  }
}
