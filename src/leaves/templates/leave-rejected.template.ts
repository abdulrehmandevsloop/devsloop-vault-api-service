import { LeaveRejectedEvent } from '../events';
import { getFrontendUrl } from '../../common/utils/frontend-url';
import {
  commentBlock,
  detailRow,
  emailShell,
  fmtLeaveType,
  isWfhType,
  requestLabel,
  requestLabelCap,
  vaultDeepLinkBlock,
} from './leave-email.helpers';

export interface LeaveRejectedEmail {
  to: string;
  subject: string;
  html: string;
  text: string;
}

export function leaveRejectedTemplate(event: LeaveRejectedEvent): LeaveRejectedEmail {
  const dateRange =
    event.startDate.toDateString() === event.endDate.toDateString()
      ? event.startDate.toDateString()
      : `${event.startDate.toDateString()} – ${event.endDate.toDateString()}`;

  const leaveTypeLabel = fmtLeaveType(event.leaveType);
  const reqLabel = requestLabel(event.leaveType);
  const reqLabelCap = requestLabelCap(event.leaveType);

  const myLeaveUrl = `${getFrontendUrl()}/leaves?leave=${event.leaveRequestId}`;
  const myLeaveLink = vaultDeepLinkBlock(myLeaveUrl, 'View leave in Vault');

  const body = `
      <p style="margin:0 0 20px;font-size:14px;color:#334155;line-height:1.6;">
        Unfortunately, your ${reqLabel} has been <strong style="color:#ef4444;">rejected by HR</strong>.
        Please review the reason below and reach out to HR if you have any questions.
      </p>
      <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;">
        ${detailRow(isWfhType(event.leaveType) ? 'Type' : 'Leave Type', leaveTypeLabel)}
        ${detailRow('Dates', dateRange, true)}
      </table>
      ${commentBlock('Reason for rejection', event.comment, '#ef4444')}
      ${myLeaveLink.html}`;

  const html = emailShell({
    accentColor: '#ef4444',
    statusIcon: '❌',
    statusText: `${reqLabelCap} Rejected`,
    greeting: `Hi ${event.employeeName},`,
    body,
    footerNote:
      'If you have questions or would like to discuss this further, please contact your HR team directly.',
  });

  const text = `Your ${reqLabel} (${leaveTypeLabel}, ${dateRange}) was rejected by HR.${event.comment ? ` Reason: ${event.comment}` : ''}${myLeaveLink.text}`;

  return {
    to: event.employeeEmail,
    subject: `Your ${reqLabelCap} Has Been Rejected – ${leaveTypeLabel}`,
    html,
    text,
  };
}
