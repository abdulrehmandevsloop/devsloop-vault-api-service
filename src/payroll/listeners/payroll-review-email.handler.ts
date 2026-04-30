import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { getFrontendUrl } from '../../common/utils/frontend-url';
import { PgBossService } from '../../queue/pg-boss.service';
import {
  PayrollSubmittedForReviewEvent,
  PayrollAuthorizedEvent,
  PayrollAuthorizationRevokedEvent,
  PayrollReviewRejectedEvent,
  PayrollRecalledFromReviewEvent,
} from '../events/payroll-review.events';

function escapeHtmlText(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function payrollPageLinkBlock(): { html: string; text: string } {
  const url = `${getFrontendUrl()}/payroll`;
  const safeHref = escapeHtmlText(url);
  const html = `
      <p style="margin:24px 0 0;text-align:center;">
        <a href="${safeHref}" style="display:inline-block;padding:12px 24px;background:#6366f1;color:#ffffff;text-decoration:none;border-radius:8px;font-size:14px;font-weight:600;">Open payroll in Vault</a>
      </p>
      <p style="margin:12px 0 0;font-size:11px;color:#94a3b8;text-align:center;word-break:break-all;line-height:1.4;">${safeHref}</p>
    `;
  const text = `\n\nOpen payroll (sign in if needed): ${url}`;
  return { html, text };
}

function emailShell(title: string, body: string): string {
  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0">
    <tr><td align="center" style="padding:32px 16px;">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;box-shadow:0 1px 3px rgba(0,0,0,.1);overflow:hidden;">
        <tr><td style="background:linear-gradient(135deg,#6366f1,#8b5cf6);padding:28px 32px;">
          <h1 style="margin:0;color:#ffffff;font-size:20px;font-weight:700;">${title}</h1>
        </td></tr>
        <tr><td style="padding:28px 32px;">${body}</td></tr>
        <tr><td style="padding:16px 32px;background:#f8fafc;border-top:1px solid #e2e8f0;">
          <p style="margin:0;font-size:12px;color:#94a3b8;text-align:center;">DevsLoop Vault &mdash; Payroll Management</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

@Injectable()
export class PayrollReviewEmailHandler {
  private readonly logger = new Logger(PayrollReviewEmailHandler.name);

  constructor(private readonly pgBoss: PgBossService) {}

  @OnEvent('payroll.submitted-for-review', { async: true })
  async onSubmittedForReview(event: PayrollSubmittedForReviewEvent): Promise<void> {
    const link = payrollPageLinkBlock();
    const body = `
      <p style="margin:0 0 16px;font-size:15px;color:#334155;line-height:1.6;">
        Payroll for <strong>${event.yearMonth}</strong> has been submitted for your review by
        <strong>${event.submitterName}</strong>.
      </p>
      <p style="margin:0 0 24px;font-size:14px;color:#64748b;line-height:1.6;">
        Please log in to the Payroll section to review and authorize the batch. Exports will remain
        locked until you approve.
      </p>
      ${link.html}
    `;

    await this.pgBoss.sendToQueue('email-notification', {
      to: event.authorizerEmail,
      subject: `Payroll Review Required — ${event.yearMonth}`,
      html: emailShell('Payroll Review Required', body),
      text: `Payroll for ${event.yearMonth} submitted by ${event.submitterName}. Please review and authorize.${link.text}`,
    });

    this.logger.log(`Sent review notification to ${event.authorizerEmail} for ${event.yearMonth}`);
  }

  @OnEvent('payroll.authorized', { async: true })
  async onAuthorized(event: PayrollAuthorizedEvent): Promise<void> {
    const link = payrollPageLinkBlock();
    const body = `
      <p style="margin:0 0 16px;font-size:15px;color:#334155;line-height:1.6;">
        Payroll for <strong>${event.yearMonth}</strong> has been verified and approved by
        <strong>${event.authorizerName}</strong>.
      </p>
      <p style="margin:0 0 24px;font-size:14px;color:#16a34a;font-weight:600;">
        Exports are now available. You may download the bank files from the Payroll section.
      </p>
      ${link.html}
    `;

    await this.pgBoss.sendToQueue('email-notification', {
      to: event.submitterEmail,
      subject: `Payroll Approved — ${event.yearMonth}`,
      html: emailShell('Payroll Authorized', body),
      text: `Payroll for ${event.yearMonth} has been verified and approved by ${event.authorizerName}. Exports are now available.${link.text}`,
    });

    this.logger.log(`Sent approval confirmation to ${event.submitterEmail} for ${event.yearMonth}`);
  }

  @OnEvent('payroll.rejected-from-review', { async: true })
  async onRejectedFromReview(event: PayrollReviewRejectedEvent): Promise<void> {
    const link = payrollPageLinkBlock();
    const noteBlock = event.comment
      ? `<p style="margin:0 0 16px;padding:12px 16px;background:#fef3c7;border-radius:8px;font-size:14px;color:#92400e;line-height:1.5;"><strong>Note from reviewer:</strong><br/>${escapeHtmlText(event.comment).replace(/\n/g, '<br/>')}</p>`
      : '';

    const body = `
      <p style="margin:0 0 16px;font-size:15px;color:#334155;line-height:1.6;">
        Payroll for <strong>${event.yearMonth}</strong> was returned for changes by
        <strong>${event.rejectorName}</strong>. Please update the sheet and submit for review again when ready.
      </p>
      ${noteBlock}
      <p style="margin:0 0 24px;font-size:14px;color:#64748b;line-height:1.6;">
        The batch is back in draft. Bank exports and payslips stay disabled until it is approved again.
      </p>
      ${link.html}
    `;

    const textNote = event.comment ? `\n\nNote: ${event.comment}` : '';

    await this.pgBoss.sendToQueue('email-notification', {
      to: event.submitterEmail,
      subject: `Payroll returned for changes — ${event.yearMonth}`,
      html: emailShell('Returned for changes', body),
      text: `Payroll for ${event.yearMonth} was returned for changes by ${event.rejectorName}. Please update and resubmit.${textNote}${link.text}`,
    });

    this.logger.log(
      `Sent reject-from-review notice to ${event.submitterEmail} for ${event.yearMonth}`,
    );
  }

  @OnEvent('payroll.recalled-from-review', { async: true })
  async onRecalledFromReview(event: PayrollRecalledFromReviewEvent): Promise<void> {
    const link = payrollPageLinkBlock();
    const body = `
      <p style="margin:0 0 16px;font-size:15px;color:#334155;line-height:1.6;">
        <strong>${escapeHtmlText(event.submitterName)}</strong> has withdrawn the payroll submission for
        <strong>${event.yearMonth}</strong>. The batch is back in <strong>draft</strong> and is no longer waiting on your review.
      </p>
      <p style="margin:0 0 24px;font-size:14px;color:#64748b;line-height:1.6;">
        No action is required unless HR submits the sheet for review again.
      </p>
      ${link.html}
    `;

    const textBase = `${event.submitterName} has withdrawn the payroll submission for ${event.yearMonth}. The batch is back in draft.${link.text}`;

    await this.pgBoss.sendToQueue('email-notification', {
      to: event.authorizerEmail,
      subject: `Payroll submission withdrawn — ${event.yearMonth}`,
      html: emailShell('Submission withdrawn', body),
      text: textBase,
    });

    this.logger.log(
      `Sent recall-from-review notice to ${event.authorizerEmail} for ${event.yearMonth}`,
    );

    const tempEmail = event.tempAuthorizerEmail?.trim();
    if (tempEmail && tempEmail.toLowerCase() !== event.authorizerEmail.toLowerCase()) {
      await this.pgBoss.sendToQueue('email-notification', {
        to: tempEmail,
        subject: `Payroll submission withdrawn — ${event.yearMonth}`,
        html: emailShell('Submission withdrawn', body),
        text: textBase,
      });
      this.logger.log(
        `Sent recall-from-review notice to temp authorizer ${tempEmail} for ${event.yearMonth}`,
      );
    }
  }

  @OnEvent('payroll.authorization-revoked', { async: true })
  async onRevoked(event: PayrollAuthorizationRevokedEvent): Promise<void> {
    const link = payrollPageLinkBlock();
    const body = `
      <p style="margin:0 0 16px;font-size:15px;color:#334155;line-height:1.6;">
        Authorization for payroll <strong>${event.yearMonth}</strong> has been revoked by
        <strong>${event.actorName}</strong>.
      </p>
      <p style="margin:0 0 24px;font-size:14px;color:#dc2626;font-weight:600;">
        Exports are now disabled. The batch has returned to review status.
      </p>
      ${link.html}
    `;

    await this.pgBoss.sendToQueue('email-notification', {
      to: event.submitterEmail,
      subject: `Payroll Authorization Revoked — ${event.yearMonth}`,
      html: emailShell('Authorization Revoked', body),
      text: `Authorization for payroll ${event.yearMonth} has been revoked by ${event.actorName}. Exports are disabled.${link.text}`,
    });

    this.logger.log(`Sent revocation notice to ${event.submitterEmail} for ${event.yearMonth}`);
  }
}
