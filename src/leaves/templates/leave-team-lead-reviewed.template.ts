import { LeaveStatus } from '@prisma/client';
import { LeaveTeamLeadReviewedEvent } from '../events';
import { getFrontendUrl } from '../../common/utils/frontend-url';
import {
  alertBanner,
  commentBlock,
  detailRow,
  emailShell,
  fmtLeaveType,
  getLeaveTypeContext,
  vaultDeepLinkBlock,
} from './leave-email.helpers';

export interface LeaveTeamLeadReviewedEmail {
  subject: string;
  html: (hrName: string) => string;
  text: string;
}

export function leaveTeamLeadReviewedTemplate(
  event: LeaveTeamLeadReviewedEvent,
): LeaveTeamLeadReviewedEmail {
  const isApproved = event.decision === LeaveStatus.TEAM_LEAD_APPROVED;
  const ctx = getLeaveTypeContext(event.leaveType);

  const dateRange =
    event.startDate.toDateString() === event.endDate.toDateString()
      ? event.startDate.toDateString()
      : `${event.startDate.toDateString()} – ${event.endDate.toDateString()}`;

  const leaveTypeLabel = fmtLeaveType(event.leaveType);

  const accentColor = isApproved ? '#3b82f6' : '#ef4444';
  const statusIcon = isApproved ? '✅' : '❌';
  const statusText = isApproved
    ? `Team Lead Approved — Awaiting HR Review`
    : `Team Lead Rejected — For Your Attention`;
  const subject = isApproved
    ? `HR Action Required: ${ctx.label} from ${event.employeeName} – ${leaveTypeLabel}`
    : `FYI: ${ctx.label} Rejected by Team Lead – ${event.employeeName}`;

  const decisionBadgeColor = isApproved ? '#16a34a' : '#dc2626';
  const decisionBadgeBg = isApproved ? '#f0fdf4' : '#fef2f2';
  const decisionLabel = isApproved ? 'TL APPROVED' : 'TL REJECTED';

  const clientBanner = event.requiresClientApproval
    ? alertBanner(
        'Client communication required',
        'The Team Lead has flagged that these leave dates must be communicated to the client before approving.',
      )
    : '';

  const hrLeaveUrl = `${getFrontendUrl()}/leave-management/${event.leaveRequestId}`;
  const hrLeaveLink = vaultDeepLinkBlock(hrLeaveUrl, 'Open leave in Vault');

  const buildBody = (hrName: string): string => {
    const body = `
        <p style="margin:0 0 20px;font-size:14px;color:#334155;line-height:1.6;">
          The following <strong>${ctx.label}</strong> has been reviewed by Team Lead
          <strong style="color:#1e293b;">${event.teamLeadName}</strong>.
          ${isApproved ? 'It is now awaiting your final HR approval.' : 'No further action is required unless you need to follow up.'}
        </p>
        <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;">
          ${detailRow('Employee', `${event.employeeName} <span style="color:#94a3b8;font-size:12px;">(${event.employeeEmail})</span>`)}
          ${detailRow('Leave Type', leaveTypeLabel, true)}
          ${detailRow('Dates', dateRange)}
          ${detailRow('Team Lead', event.teamLeadName, true)}
          ${detailRow(
            'Decision',
            `<span style="display:inline-block;padding:2px 10px;border-radius:20px;font-size:11px;font-weight:700;letter-spacing:0.05em;background:${decisionBadgeBg};color:${decisionBadgeColor};border:1px solid ${decisionBadgeColor}30;">${decisionLabel}</span>`,
          )}
        </table>
        ${commentBlock('Team Lead comment', event.comment, isApproved ? '#3b82f6' : '#ef4444')}
        ${clientBanner}
        ${hrLeaveLink.html}`;

    return emailShell({
      accentColor,
      statusIcon,
      statusText,
      greeting: `Hi ${hrName},`,
      body,
      footerNote: isApproved
        ? `Please log in to <strong>Devsloop Vault → Leave Management</strong> to complete the final review of this ${ctx.label.toLowerCase()}.`
        : 'This is a notification only. No action is required unless you choose to follow up.',
    });
  };

  const text = `Leave for ${event.employeeName} (${event.employeeEmail}), ${leaveTypeLabel}, ${dateRange}. Team Lead ${event.teamLeadName}: ${decisionLabel}.${event.comment ? ` Comment: ${event.comment}` : ''}${hrLeaveLink.text}`;

  return {
    subject,
    html: buildBody,
    text,
  };
}
