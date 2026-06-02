import { LeaveStatus } from '@prisma/client';
import { LeaveModifiedEvent } from '../events';
import { getFrontendUrl } from '../../common/utils/frontend-url';
import {
  commentBlock,
  detailRow,
  emailShell,
  fmtLeaveType,
  getLeaveTypeContext,
  vaultDeepLinkBlock,
} from './leave-email.helpers';

export interface LeaveModifiedEmail {
  to: string;
  subject: string;
  html: string;
  text: string;
}

export function leaveModifiedTemplate(event: LeaveModifiedEvent): LeaveModifiedEmail {
  const ctx = getLeaveTypeContext(event.newLeaveType);

  const fmtDate = (d: Date) => d.toDateString();
  const fmtRange = (start: Date, end: Date) =>
    start.toDateString() === end.toDateString()
      ? fmtDate(start)
      : `${fmtDate(start)} – ${fmtDate(end)}`;

  const prevTypeLabel = fmtLeaveType(event.previousLeaveType);
  const newTypeLabel = fmtLeaveType(event.newLeaveType);
  const prevDateRange = fmtRange(event.previousStartDate, event.previousEndDate);
  const newDateRange = fmtRange(event.newStartDate, event.newEndDate);

  const prevDays =
    event.previousDaysConsumed === 0.5
      ? 'Half day'
      : event.previousDaysConsumed === 1
        ? '1 day'
        : `${event.previousDaysConsumed} days`;
  const newDays =
    event.newDaysConsumed === 0.5
      ? 'Half day'
      : event.newDaysConsumed === 1
        ? '1 day'
        : `${event.newDaysConsumed} days`;

  const statusLabel = fmtLeaveType(event.newStatus.toLowerCase());
  const isNowApproved = event.newStatus === LeaveStatus.APPROVED || event.newStatus === 'MODIFIED';
  const isNowRejected = event.newStatus === LeaveStatus.REJECTED;

  const accentColor = isNowRejected ? '#ef4444' : '#8b5cf6';
  const statusIcon = isNowRejected ? '❌' : '✏️';
  const statusText = isNowRejected ? `${ctx.label} Modified & Rejected` : `${ctx.label} Modified`;

  const typeChanged = event.previousLeaveType !== event.newLeaveType;
  const datesChanged = prevDateRange !== newDateRange;
  const daysChanged = event.previousDaysConsumed !== event.newDaysConsumed;
  const statusChanged = event.previousStatus !== event.newStatus;

  const changeColor = '#8b5cf6';
  const highlight = (changed: boolean, value: string) =>
    changed ? `<span style="color:${changeColor};font-weight:600;">${value}</span>` : value;

  const myLeaveUrl = `${getFrontendUrl()}/leaves?leave=${event.leaveRequestId}`;
  const myLeaveLink = vaultDeepLinkBlock(myLeaveUrl, 'View leave in Vault');

  const body = `
      <p style="margin:0 0 20px;font-size:14px;color:#334155;line-height:1.6;">
        Your ${ctx.label.toLowerCase()} has been <strong style="color:${accentColor};">modified by HR</strong>
        (<strong>${event.hrName}</strong>). Please review the updated details below.
      </p>

      <!-- Before / After comparison -->
      <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;">
        <tr>
          <td style="background:#f8fafc;padding:8px 20px;border-bottom:1px solid #e2e8f0;" colspan="3">
            <span style="font-size:11px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:0.05em;">Change Summary</span>
          </td>
        </tr>
        <tr>
          <td style="padding:6px 20px;border-bottom:1px solid #f1f5f9;width:25%;vertical-align:top;">
            <span style="font-size:11px;font-weight:600;color:#94a3b8;text-transform:uppercase;letter-spacing:0.05em;">&nbsp;</span>
          </td>
          <td style="padding:6px 20px;border-bottom:1px solid #f1f5f9;width:37%;vertical-align:top;">
            <span style="font-size:11px;font-weight:600;color:#94a3b8;text-transform:uppercase;letter-spacing:0.05em;">Before</span>
          </td>
          <td style="padding:6px 20px;border-bottom:1px solid #f1f5f9;width:38%;vertical-align:top;">
            <span style="font-size:11px;font-weight:600;color:#94a3b8;text-transform:uppercase;letter-spacing:0.05em;">After</span>
          </td>
        </tr>
        <tr>
          <td style="padding:10px 20px;border-bottom:1px solid #f1f5f9;background:#f8fafc;">
            <span style="font-size:12px;font-weight:600;color:#64748b;">Type</span>
          </td>
          <td style="padding:10px 20px;border-bottom:1px solid #f1f5f9;background:#f8fafc;">
            <span style="font-size:13px;color:#1e293b;">${prevTypeLabel}</span>
          </td>
          <td style="padding:10px 20px;border-bottom:1px solid #f1f5f9;background:#f8fafc;">
            <span style="font-size:13px;">${highlight(typeChanged, newTypeLabel)}</span>
          </td>
        </tr>
        <tr>
          <td style="padding:10px 20px;border-bottom:1px solid #f1f5f9;">
            <span style="font-size:12px;font-weight:600;color:#64748b;">Dates</span>
          </td>
          <td style="padding:10px 20px;border-bottom:1px solid #f1f5f9;">
            <span style="font-size:13px;color:#1e293b;">${prevDateRange}</span>
          </td>
          <td style="padding:10px 20px;border-bottom:1px solid #f1f5f9;">
            <span style="font-size:13px;">${highlight(datesChanged, newDateRange)}</span>
          </td>
        </tr>
        <tr>
          <td style="padding:10px 20px;border-bottom:1px solid #f1f5f9;background:#f8fafc;">
            <span style="font-size:12px;font-weight:600;color:#64748b;">Duration</span>
          </td>
          <td style="padding:10px 20px;border-bottom:1px solid #f1f5f9;background:#f8fafc;">
            <span style="font-size:13px;color:#1e293b;">${prevDays}</span>
          </td>
          <td style="padding:10px 20px;border-bottom:1px solid #f1f5f9;background:#f8fafc;">
            <span style="font-size:13px;">${highlight(daysChanged, newDays)}</span>
          </td>
        </tr>
        ${
          statusChanged
            ? `<tr>
          <td style="padding:10px 20px;border-bottom:1px solid #f1f5f9;">
            <span style="font-size:12px;font-weight:600;color:#64748b;">Status</span>
          </td>
          <td style="padding:10px 20px;border-bottom:1px solid #f1f5f9;">
            <span style="font-size:13px;color:#1e293b;">${fmtLeaveType(event.previousStatus.toLowerCase())}</span>
          </td>
          <td style="padding:10px 20px;border-bottom:1px solid #f1f5f9;">
            <span style="font-size:13px;">${highlight(true, statusLabel)}</span>
          </td>
        </tr>`
            : ''
        }
        ${detailRow('Modified By', event.hrName, !statusChanged)}
      </table>
      ${commentBlock('HR modification reason', event.comment, accentColor)}
      ${
        isNowRejected
          ? `<table width="100%" cellpadding="0" cellspacing="0" style="margin:20px 0 0;">
          <tr>
            <td style="background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:12px 16px;">
              <p style="margin:0;font-size:13px;color:#b91c1c;line-height:1.6;">
                <strong>Note:</strong> Your leave has been rejected as part of this modification.
                Any previously deducted balance has been restored. Please contact HR if you have questions.
              </p>
            </td>
          </tr>
        </table>`
          : ''
      }
      ${myLeaveLink.html}`;

  const footerNote = isNowRejected
    ? 'If you have questions about this change, please contact your HR team.'
    : isNowApproved
      ? 'Your leave remains approved with the updated details. Your balance has been adjusted accordingly.'
      : 'If you have questions about this change, please contact your HR team.';

  const html = emailShell({
    accentColor,
    statusIcon,
    statusText,
    greeting: `Hi ${event.employeeName},`,
    body,
    footerNote,
  });

  const text = `Your ${ctx.label.toLowerCase()} was modified by HR (${event.hrName}). New details: ${newTypeLabel}, ${newDateRange}.${event.comment ? ` Note: ${event.comment}` : ''}${myLeaveLink.text}`;

  return {
    to: event.employeeEmail,
    subject: `Your ${ctx.label} Has Been Modified – ${newTypeLabel}`,
    html,
    text,
  };
}
