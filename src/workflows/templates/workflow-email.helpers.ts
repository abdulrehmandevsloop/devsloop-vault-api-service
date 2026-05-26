// ---------------------------------------------------------------------------
// Shared helpers for dynamic-workflow email templates.
// Centralises the visual shell so step-pending, completed, returned, and
// cancelled emails all look identical to the rest of the Vault suite.
// ---------------------------------------------------------------------------

export interface RequestTypeContext {
  /** Module label shown in the top-right of the brand bar */
  module: string;
  /** Human-friendly noun, e.g. "Leave Request", "Loan Request" */
  label: string;
  /** Accent colour used on the status stripe and CTA button */
  accentColor: string;
  /** Emoji rendered in the status stripe */
  icon: string;
  /**
   * Tab ID used by the Requests and Review-Requests dashboards (frontend
   * [requests-dashboard.tsx](frontend/app/(dashboard)/requests/_components/requests-dashboard.tsx)
   * and [review-requests-dashboard.tsx](frontend/app/(dashboard)/request-review/_components/review-requests-dashboard.tsx)).
   * Both pages read `?tab=<id>` to pre-select the right tab on load.
   */
  tabId: string;
}

export interface WorkflowEmailMetadataView {
  leaveType?: string;
  daysConsumed?: number;
  halfDayPeriod?: 'FIRST_HALF' | 'SECOND_HALF' | null;
  startDate?: string | Date;
  endDate?: string | Date;
  amount?: number;
  reason?: string;
  description?: string;
  reimbursementType?: string;
  customLabel?: string;
  customIcon?: string;
  customColor?: string;
}

export type WorkflowResolutionKind = 'APPROVED' | 'REJECTED' | 'CANCELLED';

export function escapeHtml(text: string): string {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function fmtPKR(amount: number): string {
  return `Rs. ${Number(amount).toLocaleString('en-PK', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })}`;
}

export function fmtDate(value: string | Date | undefined | null): string | null {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString('en-US', {
    weekday: 'short',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

export function fmtDateRange(
  start: string | Date | undefined | null,
  end: string | Date | undefined | null,
): string | null {
  const a = fmtDate(start);
  const b = fmtDate(end);
  if (!a) return null;
  if (!b || a === b) return a;
  return `${a} – ${b}`;
}

export function titleCase(raw: string): string {
  return raw
    .replace(/[_-]+/g, ' ')
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

// ── Leave-type theming (mirrors leaves/templates so workflow emails feel native)

interface LeaveTypeTheme {
  label: string;
  icon: string;
  accentColor: string;
}

export function getLeaveTypeTheme(leaveType: string | undefined): LeaveTypeTheme | null {
  if (!leaveType) return null;
  const key = String(leaveType).toUpperCase();
  switch (key) {
    case 'SICK':
      return { label: 'Sick Leave', icon: '🌡️', accentColor: '#22c55e' };
    case 'CASUAL':
      return { label: 'Casual Leave', icon: '🌿', accentColor: '#22c55e' };
    case 'HALF_DAY':
      return { label: 'Half Day Leave', icon: '🕐', accentColor: '#22c55e' };
    case 'WFH':
    case 'WORK_FROM_HOME':
      return { label: 'WFH Request', icon: '🏠', accentColor: '#0ea5e9' };
    case 'MATERNITY':
      return { label: 'Maternity Leave', icon: '👶', accentColor: '#ec4899' };
    case 'WEDDING':
      return { label: 'Wedding Leave', icon: '💍', accentColor: '#f59e0b' };
    case 'UMRAH_HAJJ':
      return { label: 'Umrah / Hajj Leave', icon: '🕌', accentColor: '#10b981' };
    case 'OTHER':
      return { label: 'Other Leave', icon: '🗓️', accentColor: '#6366f1' };
    default:
      return { label: titleCase(key), icon: '🗓️', accentColor: '#6366f1' };
  }
}

export function formatDuration(days: number | undefined, halfDayPeriod?: string | null): string {
  if (typeof days !== 'number') return '—';
  if (days === 0.5) {
    if (halfDayPeriod === 'FIRST_HALF') return 'Half day (first half)';
    if (halfDayPeriod === 'SECOND_HALF') return 'Half day (second half)';
    return 'Half day';
  }
  if (days === 1) return '1 day';
  return `${days} days`;
}

// ── Request-type context registry

const BUILTIN_CONTEXTS: Record<string, RequestTypeContext> = {
  LEAVE: {
    module: 'Leave Management',
    label: 'Leave Request',
    accentColor: '#6366f1',
    icon: '🗓️',
    tabId: 'leaves',
  },
  ADVANCE_SALARY: {
    module: 'Advance Salary',
    label: 'Advance Salary Request',
    accentColor: '#8b5cf6',
    icon: '💵',
    tabId: 'advance-salary',
  },
  LOAN: {
    module: 'Loans',
    label: 'Loan Request',
    accentColor: '#0ea5e9',
    icon: '🏦',
    tabId: 'loans',
  },
  REIMBURSEMENT: {
    module: 'Reimbursements',
    label: 'Reimbursement Request',
    accentColor: '#3b82f6',
    icon: '🧾',
    tabId: 'reimbursements',
  },
};

export function getRequestTypeContext(
  requestType: string,
  metadata?: WorkflowEmailMetadataView,
): RequestTypeContext {
  const builtin = BUILTIN_CONTEXTS[requestType];

  if (requestType === 'LEAVE') {
    const theme = getLeaveTypeTheme(metadata?.leaveType);
    return {
      module: builtin.module,
      label: theme?.label ?? builtin.label,
      accentColor: theme?.accentColor ?? builtin.accentColor,
      icon: theme?.icon ?? builtin.icon,
      tabId: builtin.tabId,
    };
  }

  if (builtin) return builtin;

  // Dynamic request type — the dashboard tab id is the type key itself
  // (see `dynamicTypes.map((rt) => ({ id: rt.key, ... }))` in the dashboard).
  return {
    module: metadata?.customLabel ?? titleCase(requestType),
    label: metadata?.customLabel ?? titleCase(requestType),
    accentColor: metadata?.customColor ?? '#6366f1',
    icon: metadata?.customIcon ?? '📄',
    tabId: requestType,
  };
}

/** Approver-facing URL: lands on `/request-review` with the right tab open. */
export function buildReviewerUrl(ctx: RequestTypeContext, requestId: string): string {
  const params = new URLSearchParams({ tab: ctx.tabId, requestId });
  return `/request-review?${params.toString()}`;
}

/** Requester-facing URL: lands on `/requests` with the right tab open. */
export function buildRequesterUrl(ctx: RequestTypeContext, requestId: string): string {
  const params = new URLSearchParams({ tab: ctx.tabId, requestId });
  return `/requests?${params.toString()}`;
}

// ── Reusable visual building blocks

export function detailRow(label: string, value: string, shade = false): string {
  const bg = shade ? 'background:#f8fafc;' : 'background:#ffffff;';
  return `
    <tr>
      <td style="${bg}padding:10px 20px;border-bottom:1px solid #f1f5f9;width:35%;vertical-align:top;">
        <span style="font-size:12px;font-weight:600;color:#94a3b8;text-transform:uppercase;letter-spacing:0.05em;">${escapeHtml(label)}</span>
      </td>
      <td style="${bg}padding:10px 20px;border-bottom:1px solid #f1f5f9;vertical-align:top;">
        <span style="font-size:14px;color:#1e293b;">${value}</span>
      </td>
    </tr>`;
}

export function commentBlock(label: string, comment: string, color: string): string {
  if (!comment) return '';
  return `
    <table width="100%" cellpadding="0" cellspacing="0" style="margin:24px 0 0;">
      <tr>
        <td style="background:${color}10;border-left:3px solid ${color};border-radius:0 6px 6px 0;padding:12px 16px;">
          <p style="margin:0 0 4px;font-size:11px;font-weight:700;color:${color};text-transform:uppercase;letter-spacing:0.06em;">${escapeHtml(label)}</p>
          <p style="margin:0;font-size:14px;color:#334155;line-height:1.6;white-space:pre-wrap;">${escapeHtml(comment)}</p>
        </td>
      </tr>
    </table>`;
}

export function statusBadge(text: string, color: string): string {
  return `<span style="display:inline-block;padding:3px 10px;border-radius:999px;font-size:11px;font-weight:700;background:${color}15;color:${color};border:1px solid ${color}40;text-transform:uppercase;letter-spacing:0.06em;">${escapeHtml(text)}</span>`;
}

export function ctaButton(
  url: string,
  buttonLabel: string,
  color: string,
): { html: string; text: string } {
  const safeHref = escapeHtml(url);
  const safeLabel = escapeHtml(buttonLabel);
  const html = `
      <p style="margin:24px 0 0;text-align:center;">
        <a href="${safeHref}" style="display:inline-block;padding:12px 26px;background:${color};color:#ffffff;text-decoration:none;border-radius:8px;font-size:14px;font-weight:600;">${safeLabel}</a>
      </p>
      <p style="margin:10px 0 0;font-size:11px;color:#94a3b8;text-align:center;word-break:break-all;line-height:1.4;">${safeHref}</p>
    `;
  const text = `\n\n${buttonLabel}: ${url}`;
  return { html, text };
}

// ── Email shell

export function emailShell(opts: {
  module: string;
  accentColor: string;
  statusIcon: string;
  statusText: string;
  greeting: string;
  body: string;
  footerNote?: string;
}): string {
  const { module: mod, accentColor, statusIcon, statusText, greeting, body, footerNote } = opts;
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>${escapeHtml(statusText)}</title>
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
                    <span style="font-size:11px;color:#475569;font-weight:500;letter-spacing:0.05em;text-transform:uppercase;">${escapeHtml(mod)}</span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Status stripe -->
          <tr>
            <td style="background:${accentColor};padding:20px 28px;">
              <span style="font-size:22px;line-height:1;">${statusIcon}</span>
              <span style="font-size:16px;font-weight:700;color:#ffffff;margin-left:10px;vertical-align:middle;">${escapeHtml(statusText)}</span>
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
              <p style="margin:0;font-size:12px;color:#475569;">This is an automated message from <strong style="color:#94a3b8;">Devsloop Vault</strong>. Please do not reply.</p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

// ── Detail-row composer common to all workflow emails

export function buildRequestDetailRows(opts: {
  requestType: string;
  requesterName: string;
  ctx: RequestTypeContext;
  metadata: WorkflowEmailMetadataView;
}): string {
  const { requestType, requesterName, ctx, metadata } = opts;
  const rows: string[] = [];
  let i = 0;
  const push = (label: string, value: string) => {
    rows.push(detailRow(label, value, i % 2 === 1));
    i++;
  };

  push('Request', escapeHtml(ctx.label));
  push('Requester', escapeHtml(requesterName));

  if (requestType === 'LEAVE') {
    if (metadata.leaveType) {
      const theme = getLeaveTypeTheme(metadata.leaveType);
      push(
        'Leave Type',
        `${theme?.icon ?? ''} ${escapeHtml(theme?.label ?? metadata.leaveType)}`.trim(),
      );
    }
    const range = fmtDateRange(metadata.startDate, metadata.endDate);
    if (range) push('Dates', escapeHtml(range));
    if (typeof metadata.daysConsumed === 'number') {
      push(
        'Duration',
        escapeHtml(formatDuration(metadata.daysConsumed, metadata.halfDayPeriod ?? null)),
      );
    }
  } else {
    if (metadata.reimbursementType) {
      push('Type', escapeHtml(titleCase(metadata.reimbursementType)));
    }
    if (typeof metadata.amount === 'number') {
      push('Amount', escapeHtml(fmtPKR(metadata.amount)));
    }
  }

  if (metadata.reason) push('Reason', escapeHtml(metadata.reason));
  else if (metadata.description) push('Description', escapeHtml(metadata.description));

  return `
    <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;">
      ${rows.join('')}
    </table>`;
}
