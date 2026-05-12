import { LeaveApprovedEvent } from '../events';
import { getFrontendUrl } from '../../common/utils/frontend-url';
import {
  commentBlock,
  detailRow,
  emailShell,
  fmtLeaveType,
  getLeaveTypeContext,
  isWfhType,
  vaultDeepLinkBlock,
} from './leave-email.helpers';

export interface LeaveApprovedEmail {
  to: string;
  subject: string;
  html: string;
  text: string;
}

export function leaveApprovedTemplate(event: LeaveApprovedEvent): LeaveApprovedEmail {
  const dateRange =
    event.startDate.toDateString() === event.endDate.toDateString()
      ? event.startDate.toDateString()
      : `${event.startDate.toDateString()} – ${event.endDate.toDateString()}`;

  const isWfhConversion = event.convertedToWfh === true && !!event.originalLeaveType;
  const isDirectWfh = !isWfhConversion && isWfhType(event.leaveType);
  const isAnyWfh = isWfhConversion || isDirectWfh;

  const effectiveType = isWfhConversion ? event.originalLeaveType : event.leaveType;
  const ctx = isAnyWfh ? getLeaveTypeContext('WFH') : getLeaveTypeContext(effectiveType);
  const leaveTypeLabel = fmtLeaveType(effectiveType);

  const daysLabel =
    event.daysConsumed === 0.5
      ? 'Half day'
      : event.daysConsumed === 1
        ? '1 day'
        : `${event.daysConsumed} days`;

  const isUnpaid = event.category === 'UNPAID';
  const categoryBadge = isAnyWfh
    ? ''
    : event.category
      ? `&nbsp;<span style="display:inline-block;padding:1px 8px;border-radius:20px;font-size:11px;font-weight:700;letter-spacing:0.04em;${
          isUnpaid
            ? 'background:#fef2f2;color:#dc2626;border:1px solid #fca5a5;'
            : 'background:#f0fdf4;color:#16a34a;border:1px solid #86efac;'
        }">${event.category}</span>`
      : '';

  const unpaidNote =
    isUnpaid && !isAnyWfh
      ? `
        <table width="100%" cellpadding="0" cellspacing="0" style="margin:20px 0 0;">
          <tr>
            <td style="background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:12px 16px;">
              <p style="margin:0;font-size:13px;color:#b91c1c;line-height:1.6;">
                <strong>Unpaid leave notice:</strong> The approved ${daysLabel} will be deducted from your salary as unpaid leave.
                If you believe this is incorrect, please contact HR.
              </p>
            </td>
          </tr>
        </table>`
      : '';

  const subject = isWfhConversion
    ? 'Your Leave Was Approved as Work From Home'
    : isDirectWfh
      ? 'Your WFH Request Has Been Approved ✓'
      : `Your ${ctx.label} Has Been Approved ✓`;

  const accentColor = isUnpaid && !isAnyWfh ? '#f59e0b' : ctx.accentColor;
  const statusIcon = isUnpaid && !isAnyWfh ? '⚠️' : ctx.statusIcon;
  const statusText = isWfhConversion
    ? 'Approved as Work From Home'
    : isDirectWfh
      ? 'WFH Request Approved'
      : isUnpaid
        ? `${ctx.label} Approved — Unpaid`
        : `${ctx.label} Approved`;

  const wfhNote = isWfhConversion
    ? `
        <table width="100%" cellpadding="0" cellspacing="0" style="margin:20px 0 0;">
          <tr>
            <td style="background:#f0f9ff;border:1px solid #bae6fd;border-radius:8px;padding:12px 16px;">
              <p style="margin:0;font-size:13px;color:#0369a1;line-height:1.6;">
                <strong>Note:</strong> Your <strong>${leaveTypeLabel}</strong> leave was converted to a Work From Home day.
                Your leave balance remains unchanged and your WFH counter has been updated.
              </p>
            </td>
          </tr>
        </table>`
    : isDirectWfh
      ? `
        <table width="100%" cellpadding="0" cellspacing="0" style="margin:20px 0 0;">
          <tr>
            <td style="background:#f0f9ff;border:1px solid #bae6fd;border-radius:8px;padding:12px 16px;">
              <p style="margin:0;font-size:13px;color:#0369a1;line-height:1.6;">
                <strong>Note:</strong> Your WFH day has been recorded and your WFH counter has been updated.
              </p>
            </td>
          </tr>
        </table>`
      : '';

  const myLeaveUrl = `${getFrontendUrl()}/leaves?leave=${event.leaveRequestId}`;
  const myLeaveLink = vaultDeepLinkBlock(myLeaveUrl, 'View leave in Vault');

  const approvedIntro = isWfhConversion
    ? `Great news! Your request has been <strong style="color:${accentColor};">approved as Work From Home</strong> by HR.`
    : ctx.approvedIntro
        .replace('color:#22c55e', `color:${accentColor}`)
        .replace('color:#0ea5e9', `color:${accentColor}`);

  const body = `
      <p style="margin:0 0 20px;font-size:14px;color:#334155;line-height:1.6;">
        ${approvedIntro}
      </p>
      <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;">
        ${detailRow('Type', isWfhConversion ? `${leaveTypeLabel} <span style="color:#0ea5e9;font-size:12px;">→ Work From Home</span>` : `${leaveTypeLabel}${categoryBadge}`)}
        ${detailRow('Dates', dateRange, true)}
        ${detailRow('Duration', daysLabel)}
        ${detailRow('Approved By', event.hrName, true)}
      </table>
      ${commentBlock('HR comment', event.comment, accentColor)}
      ${wfhNote}
      ${unpaidNote}
      ${myLeaveLink.html}`;

  const footerNote =
    isUnpaid && !isAnyWfh
      ? 'Please note that this leave is unpaid. Reach out to HR if you have any questions.'
      : ctx.approvedFooter;

  const html = emailShell({
    accentColor,
    statusIcon,
    statusText,
    greeting: `Hi ${event.employeeName},`,
    body,
    footerNote,
  });

  const text = isDirectWfh
    ? `Your WFH request (${dateRange}) was approved by HR (${event.hrName}).${event.comment ? ` Comment: ${event.comment}` : ''}${myLeaveLink.text}`
    : `Your ${ctx.label} (${leaveTypeLabel}, ${dateRange}) was approved by HR (${event.hrName}).${event.comment ? ` Comment: ${event.comment}` : ''}${myLeaveLink.text}`;

  return {
    to: event.employeeEmail,
    subject,
    html,
    text,
  };
}
