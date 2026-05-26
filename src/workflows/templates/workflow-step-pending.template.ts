import { getFrontendUrl } from '../../common/utils/frontend-url';
import {
  buildRequestDetailRows,
  buildReviewerUrl,
  ctaButton,
  detailRow,
  emailShell,
  escapeHtml,
  getRequestTypeContext,
  statusBadge,
  WorkflowEmailMetadataView,
} from './workflow-email.helpers';

export interface WorkflowStepPendingInput {
  approverName: string;
  approverEmail: string;
  requesterName: string;
  requestType: string;
  requestId: string;
  stepOrder: number;
  totalSteps: number;
  stepName: string;
  metadata: WorkflowEmailMetadataView;
}

export interface RenderedEmail {
  to: string;
  subject: string;
  html: string;
  text: string;
}

export function workflowStepPendingTemplate(input: WorkflowStepPendingInput): RenderedEmail {
  const ctx = getRequestTypeContext(input.requestType, input.metadata);
  const cta = ctaButton(
    `${getFrontendUrl()}${buildReviewerUrl(ctx, input.requestId)}`,
    `Review in Vault`,
    ctx.accentColor,
  );

  const stepProgress = `Step ${input.stepOrder} of ${input.totalSteps}`;

  const detailsTable = buildRequestDetailRows({
    requestType: input.requestType,
    requesterName: input.requesterName,
    ctx,
    metadata: input.metadata,
  });

  const stepBanner = `
    <table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 18px;">
      <tr>
        <td style="background:${ctx.accentColor}10;border:1px solid ${ctx.accentColor}30;border-radius:8px;padding:12px 16px;">
          <table width="100%" cellpadding="0" cellspacing="0">
            <tr>
              <td>
                <p style="margin:0 0 4px;font-size:11px;font-weight:700;color:${ctx.accentColor};text-transform:uppercase;letter-spacing:0.06em;">Awaiting Your Decision</p>
                <p style="margin:0;font-size:15px;font-weight:700;color:#0f172a;">${escapeHtml(input.stepName)}</p>
              </td>
              <td align="right">${statusBadge(stepProgress, ctx.accentColor)}</td>
            </tr>
          </table>
        </td>
      </tr>
    </table>`;

  const body = `
      <p style="margin:0 0 18px;font-size:14px;color:#334155;line-height:1.6;">
        <strong style="color:#1e293b;">${escapeHtml(input.requesterName)}</strong> has submitted a ${escapeHtml(ctx.label.toLowerCase())} that requires your review.
      </p>
      ${stepBanner}
      ${detailsTable}
      ${cta.html}`;

  const html = emailShell({
    module: ctx.module,
    accentColor: ctx.accentColor,
    statusIcon: ctx.icon,
    statusText: `Action Required — ${ctx.label}`,
    greeting: `Hi ${escapeHtml(input.approverName || 'there')},`,
    body,
    footerNote: `Log in to <strong>Devsloop Vault</strong> to approve, return, or reject this ${escapeHtml(ctx.label.toLowerCase())}.`,
  });

  const text = `${input.requesterName} submitted a ${ctx.label.toLowerCase()} awaiting your decision (${stepProgress} — ${input.stepName}).${cta.text}`;

  return {
    to: input.approverEmail,
    subject: `Action Required: ${ctx.label} from ${input.requesterName}`,
    html,
    text,
  };
}

// Re-export detailRow so external callers can extend if needed
export { detailRow };
