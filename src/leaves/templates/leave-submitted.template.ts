import { LeaveSubmittedEvent } from '../events';
import { getFrontendUrl } from '../../common/utils/frontend-url';
import {
  detailRow,
  emailShell,
  fmtLeaveType,
  getLeaveTypeContext,
  vaultDeepLinkBlock,
} from './leave-email.helpers';

export interface LeaveSubmittedEmail {
  to: string;
  subject: string;
  html: string;
  text: string;
}

export function leaveSubmittedTemplate(event: LeaveSubmittedEvent): LeaveSubmittedEmail {
  const ctx = getLeaveTypeContext(event.leaveType);

  const dateRange =
    event.startDate.toDateString() === event.endDate.toDateString()
      ? event.startDate.toDateString()
      : `${event.startDate.toDateString()} – ${event.endDate.toDateString()}`;

  const leaveTypeLabel = fmtLeaveType(event.leaveType);
  const daysLabel =
    event.daysConsumed === 0.5
      ? 'Half day'
      : event.daysConsumed === 1
        ? '1 day'
        : `${event.daysConsumed} days`;

  const reviewUrl = `${getFrontendUrl()}/leave-review?leave=${event.leaveRequestId}`;
  const reviewLink = vaultDeepLinkBlock(reviewUrl, 'Review leave in Vault');

  const body = `
      <p style="margin:0 0 20px;font-size:14px;color:#334155;line-height:1.6;">
        <strong style="color:#1e293b;">${event.employeeName}</strong>
        (${event.employeeEmail}) ${ctx.submittedManagerNote}
      </p>
      <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;">
        ${detailRow('Employee', event.employeeName)}
        ${detailRow('Leave Type', leaveTypeLabel, true)}
        ${detailRow('Dates', dateRange)}
        ${detailRow('Duration', daysLabel, true)}
      </table>
      ${reviewLink.html}`;

  const html = emailShell({
    accentColor: '#6366f1',
    statusIcon: ctx.statusIcon,
    statusText: `New ${ctx.label} — Action Required`,
    greeting: `Hi ${event.reportingManagerName},`,
    body,
    footerNote: `Please log in to <strong>Devsloop Vault</strong> to approve or reject this ${ctx.label.toLowerCase()}.`,
  });

  const text = `${event.employeeName} (${event.employeeEmail}) submitted a ${leaveTypeLabel} for ${dateRange} (${daysLabel}). Action required.${reviewLink.text}`;

  return {
    to: event.reportingManagerEmail,
    subject: `Action Required: ${ctx.label} from ${event.employeeName} – ${leaveTypeLabel}`,
    html,
    text,
  };
}
