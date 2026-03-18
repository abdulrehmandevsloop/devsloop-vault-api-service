import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { PgBossService } from '../../queue/pg-boss.service';
import {
  LeaveApprovedEvent,
  LeaveRejectedEvent,
  LeaveSubmittedEvent,
  LeaveTeamLeadReviewedEvent,
} from '../events';
import { LeaveStatus } from '@prisma/client';
import { PrismaService } from '../../prisma';

// ---------------------------------------------------------------------------
// Shared email layout helpers
// ---------------------------------------------------------------------------

function fmtLeaveType(raw: string): string {
  return raw.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function detailRow(label: string, value: string, shade = false): string {
  const bg = shade ? 'background:#f8fafc;' : 'background:#ffffff;';
  return `
    <tr>
      <td style="${bg}padding:10px 20px;border-bottom:1px solid #f1f5f9;width:35%;vertical-align:top;">
        <span style="font-size:12px;font-weight:600;color:#94a3b8;text-transform:uppercase;letter-spacing:0.05em;">${label}</span>
      </td>
      <td style="${bg}padding:10px 20px;border-bottom:1px solid #f1f5f9;vertical-align:top;">
        <span style="font-size:14px;color:#1e293b;">${value}</span>
      </td>
    </tr>`;
}

function commentBlock(label: string, comment: string, color: string): string {
  if (!comment) return '';
  return `
    <table width="100%" cellpadding="0" cellspacing="0" style="margin:24px 0 0;">
      <tr>
        <td style="background:${color}08;border-left:3px solid ${color};border-radius:0 6px 6px 0;padding:12px 16px;">
          <p style="margin:0 0 4px;font-size:11px;font-weight:700;color:${color};text-transform:uppercase;letter-spacing:0.06em;">${label}</p>
          <p style="margin:0;font-size:14px;color:#334155;line-height:1.6;">${comment}</p>
        </td>
      </tr>
    </table>`;
}

function alertBanner(text: string, subtext: string): string {
  return `
    <table width="100%" cellpadding="0" cellspacing="0" style="margin:20px 0 0;">
      <tr>
        <td style="background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:12px 16px;">
          <table width="100%" cellpadding="0" cellspacing="0">
            <tr>
              <td width="24" style="vertical-align:top;padding-top:1px;">
                <span style="font-size:16px;">⚠️</span>
              </td>
              <td style="padding-left:8px;">
                <p style="margin:0 0 2px;font-size:13px;font-weight:700;color:#92400e;">${text}</p>
                <p style="margin:0;font-size:12px;color:#b45309;line-height:1.5;">${subtext}</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>`;
}

/**
 * Wraps content in the standard Devsloop Vault email shell.
 * @param accentColor  hex colour for the top status stripe
 * @param statusIcon   emoji / symbol shown in the stripe
 * @param statusText   short headline shown in the stripe
 * @param greeting     "Hi Name," line
 * @param body         inner HTML between greeting and footer note
 * @param footerNote   closing line (e.g. "Enjoy your time off!")
 */
function emailShell(opts: {
  accentColor: string;
  statusIcon: string;
  statusText: string;
  greeting: string;
  body: string;
  footerNote?: string;
}): string {
  const { accentColor, statusIcon, statusText, greeting, body, footerNote } = opts;
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>${statusText}</title>
</head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:Arial,Helvetica,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:32px 16px;">
    <tr>
      <td align="center">
        <table width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;">

          <!-- Brand header -->
          <tr>
            <td style="background:#0f172a;border-radius:10px 10px 0 0;padding:18px 28px;">
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td>
                    <span style="font-size:16px;font-weight:700;color:#f8fafc;letter-spacing:0.02em;">Devsloop</span>
                    <span style="font-size:16px;font-weight:400;color:#94a3b8;"> Vault</span>
                  </td>
                  <td align="right">
                    <span style="font-size:11px;color:#475569;font-weight:500;letter-spacing:0.05em;text-transform:uppercase;">Leave Management</span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Status stripe -->
          <tr>
            <td style="background:${accentColor};padding:20px 28px;">
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td>
                    <span style="font-size:22px;line-height:1;">${statusIcon}</span>
                    <span style="font-size:16px;font-weight:700;color:#ffffff;margin-left:10px;vertical-align:middle;">${statusText}</span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Card body -->
          <tr>
            <td style="background:#ffffff;padding:28px 28px 8px;border-left:1px solid #e2e8f0;border-right:1px solid #e2e8f0;">
              <p style="margin:0 0 20px;font-size:15px;color:#334155;line-height:1.5;">${greeting}</p>
              ${body}
            </td>
          </tr>

          ${
            footerNote
              ? `
          <!-- Closing note -->
          <tr>
            <td style="background:#ffffff;padding:20px 28px 28px;border-left:1px solid #e2e8f0;border-right:1px solid #e2e8f0;">
              <p style="margin:0;font-size:14px;color:#64748b;line-height:1.6;">${footerNote}</p>
            </td>
          </tr>`
              : ''
          }

          <!-- Footer -->
          <tr>
            <td style="background:#0f172a;border-radius:0 0 10px 10px;padding:16px 28px;">
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td>
                    <p style="margin:0;font-size:12px;color:#475569;">This is an automated message from <strong style="color:#94a3b8;">Devsloop Vault</strong>. Please do not reply.</p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

@Injectable()
export class LeaveEmailHandler {
  private readonly logger = new Logger(LeaveEmailHandler.name);

  constructor(
    private readonly pgBossService: PgBossService,
    private readonly prisma: PrismaService,
  ) {}

  // ── Leave submitted → notify Team Lead ────────────────────────────────────

  @OnEvent('leave.submitted', { async: true })
  async handleLeaveSubmitted(event: LeaveSubmittedEvent) {
    this.logger.log(
      `Sending leave submission notification to reporting manager ${event.reportingManagerEmail} for employee ${event.employeeEmail}`,
    );

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

    const body = `
      <p style="margin:0 0 20px;font-size:14px;color:#334155;line-height:1.6;">
        <strong style="color:#1e293b;">${event.employeeName}</strong>
        (${event.employeeEmail}) has submitted a new leave request that requires your review.
      </p>
      <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;">
        ${detailRow('Employee', event.employeeName)}
        ${detailRow('Leave Type', leaveTypeLabel, true)}
        ${detailRow('Dates', dateRange)}
        ${detailRow('Duration', daysLabel, true)}
      </table>`;

    const html = emailShell({
      accentColor: '#6366f1',
      statusIcon: '📋',
      statusText: 'New Leave Request — Action Required',
      greeting: `Hi ${event.reportingManagerName},`,
      body,
      footerNote:
        'Please log in to <strong>Devsloop Vault</strong> to approve or reject this request.',
    });

    await this.pgBossService.sendToQueue('email-notification', {
      to: event.reportingManagerEmail,
      subject: `Action Required: Leave Request from ${event.employeeName} – ${leaveTypeLabel}`,
      html,
    });
  }

  // ── Team lead reviewed → notify HR ────────────────────────────────────────

  @OnEvent('leave.teamLeadReviewed', { async: true })
  async handleTeamLeadReviewed(event: LeaveTeamLeadReviewedEvent) {
    const isApproved = event.decision === LeaveStatus.TEAM_LEAD_APPROVED;

    this.logger.log(
      `Sending team lead review notification to HR for leave ${event.leaveRequestId} (${event.decision})`,
    );

    const hrUsers = await this.prisma.user.findMany({
      where: {
        isSystem: false,
        employeeStatus: 'ACTIVE',
        userRoleAssignments: {
          some: {
            role: {
              isActive: true,
              roleEntities: {
                some: { entity: { name: 'user', isActive: true } },
              },
            },
          },
        },
      },
      select: { id: true, email: true, name: true },
    });

    if (!hrUsers.length) {
      this.logger.warn(
        `No HR users found; skipping team lead review email for leave ${event.leaveRequestId}`,
      );
      return;
    }

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
      ? `HR Action Required: Leave Request from ${event.employeeName} – ${leaveTypeLabel}`
      : `FYI: Leave Rejected by Team Lead – ${event.employeeName}`;

    const decisionBadgeColor = isApproved ? '#16a34a' : '#dc2626';
    const decisionBadgeBg = isApproved ? '#f0fdf4' : '#fef2f2';
    const decisionLabel = isApproved ? 'TL APPROVED' : 'TL REJECTED';

    const clientBanner = event.requiresClientApproval
      ? alertBanner(
          'Client communication required',
          'The Team Lead has flagged that these leave dates must be communicated to the client before approving.',
        )
      : '';

    const htmlBody = (hrName: string) => {
      const body = `
        <p style="margin:0 0 20px;font-size:14px;color:#334155;line-height:1.6;">
          The following leave request has been reviewed by Team Lead
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
        ${clientBanner}`;

      return emailShell({
        accentColor,
        statusIcon,
        statusText,
        greeting: `Hi ${hrName},`,
        body,
        footerNote: isApproved
          ? 'Please log in to <strong>Devsloop Vault → Leave Management</strong> to complete the final review.'
          : 'This is a notification only. No action is required unless you choose to follow up.',
      });
    };

    await Promise.all(
      hrUsers.map((hr) =>
        this.pgBossService.sendToQueue('email-notification', {
          to: hr.email,
          subject,
          html: htmlBody(hr.name ?? 'HR'),
        }),
      ),
    );
  }

  // ── Leave approved (final, by HR) → notify Employee ───────────────────────

  @OnEvent('leave.approved', { async: true })
  async handleLeaveApproved(event: LeaveApprovedEvent) {
    this.logger.log(`Sending final approval email to ${event.employeeEmail}`);

    const dateRange =
      event.startDate.toDateString() === event.endDate.toDateString()
        ? event.startDate.toDateString()
        : `${event.startDate.toDateString()} – ${event.endDate.toDateString()}`;

    const isWfhConversion = event.convertedToWfh === true && !!event.originalLeaveType;
    const leaveTypeLabel = fmtLeaveType(
      isWfhConversion ? event.originalLeaveType : event.leaveType,
    );
    const daysLabel =
      event.daysConsumed === 0
        ? '—'
        : event.daysConsumed === 0.5
          ? 'Half day'
          : event.daysConsumed === 1
            ? '1 day'
            : `${event.daysConsumed} days`;

    const subject = isWfhConversion
      ? `Your Leave Was Approved as Work From Home`
      : `Your Leave Request Has Been Approved ✓`;

    const accentColor = isWfhConversion ? '#0ea5e9' : '#22c55e';
    const statusIcon = isWfhConversion ? '🏠' : '✅';
    const statusText = isWfhConversion ? 'Approved as Work From Home' : 'Leave Request Approved';

    const wfhConversionNote = isWfhConversion
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
      : '';

    const body = `
      <p style="margin:0 0 20px;font-size:14px;color:#334155;line-height:1.6;">
        Great news! Your leave request has been <strong style="color:${accentColor};">fully approved</strong> by HR.
      </p>
      <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;">
        ${detailRow('Leave Type', isWfhConversion ? `${leaveTypeLabel} <span style="color:#0ea5e9;font-size:12px;">→ Work From Home</span>` : leaveTypeLabel)}
        ${detailRow('Dates', dateRange, true)}
        ${isWfhConversion ? '' : detailRow('Days Deducted', daysLabel)}
        ${detailRow('Approved By', event.hrName, isWfhConversion)}
      </table>
      ${commentBlock('HR comment', event.comment, accentColor)}
      ${wfhConversionNote}`;

    const footerNote = isWfhConversion
      ? 'Your WFH day has been recorded. Enjoy working from home!'
      : 'Take care and enjoy your time off. See you when you return! 🌴';

    const html = emailShell({
      accentColor,
      statusIcon,
      statusText,
      greeting: `Hi ${event.employeeName},`,
      body,
      footerNote,
    });

    await this.pgBossService.sendToQueue('email-notification', {
      to: event.employeeEmail,
      subject,
      html,
    });
  }

  // ── Leave rejected (final, by HR) → notify Employee ───────────────────────

  @OnEvent('leave.rejected', { async: true })
  async handleLeaveRejected(event: LeaveRejectedEvent) {
    this.logger.log(`Sending final rejection email to ${event.employeeEmail}`);

    const dateRange =
      event.startDate.toDateString() === event.endDate.toDateString()
        ? event.startDate.toDateString()
        : `${event.startDate.toDateString()} – ${event.endDate.toDateString()}`;

    const leaveTypeLabel = fmtLeaveType(event.leaveType);

    const body = `
      <p style="margin:0 0 20px;font-size:14px;color:#334155;line-height:1.6;">
        Unfortunately, your leave request has been <strong style="color:#ef4444;">rejected by HR</strong>.
        Please review the reason below and reach out to HR if you have any questions.
      </p>
      <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;">
        ${detailRow('Leave Type', leaveTypeLabel)}
        ${detailRow('Dates', dateRange, true)}
      </table>
      ${commentBlock('Reason for rejection', event.comment, '#ef4444')}`;

    const html = emailShell({
      accentColor: '#ef4444',
      statusIcon: '❌',
      statusText: 'Leave Request Rejected',
      greeting: `Hi ${event.employeeName},`,
      body,
      footerNote:
        'If you have questions or would like to discuss this further, please contact your HR team directly.',
    });

    await this.pgBossService.sendToQueue('email-notification', {
      to: event.employeeEmail,
      subject: `Your Leave Request Has Been Rejected – ${leaveTypeLabel}`,
      html,
    });
  }
}
