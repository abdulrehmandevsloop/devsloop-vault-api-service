import { getFrontendUrl } from '../../common/utils/frontend-url';
import {
  buildRequestDetailRows,
  buildRequesterUrl,
  commentBlock,
  ctaButton,
  emailShell,
  escapeHtml,
  getRequestTypeContext,
  statusBadge,
  WorkflowEmailMetadataView,
} from './workflow-email.helpers';
import type { RenderedEmail } from './workflow-step-pending.template';

export interface WorkflowReturnedToRequesterInput {
  requesterName: string;
  requesterEmail: string;
  requestType: string;
  requestId: string;
  returnedFromStepName: string;
  actorName?: string | null;
  comment?: string | null;
  returnCount: number;
  maxReturnCount?: number | null;
  metadata: WorkflowEmailMetadataView;
}

const RETURNED_COLOR = '#f59e0b';

export function workflowReturnedToRequesterTemplate(
  input: WorkflowReturnedToRequesterInput,
): RenderedEmail {
  const ctx = getRequestTypeContext(input.requestType, input.metadata);
  const cta = ctaButton(
    `${getFrontendUrl()}${buildRequesterUrl(ctx, input.requestId)}`,
    `Update & Resubmit`,
    RETURNED_COLOR,
  );

  const detailsTable = buildRequestDetailRows({
    requestType: input.requestType,
    requesterName: input.requesterName,
    ctx,
    metadata: input.metadata,
  });

  const returnsBadge = input.maxReturnCount
    ? statusBadge(`Return ${input.returnCount} of ${input.maxReturnCount}`, RETURNED_COLOR)
    : statusBadge(`Return #${input.returnCount}`, RETURNED_COLOR);

  const returnedBanner = `
    <table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 18px;">
      <tr>
        <td style="background:${RETURNED_COLOR}15;border:1px solid ${RETURNED_COLOR}40;border-radius:8px;padding:12px 16px;">
          <table width="100%" cellpadding="0" cellspacing="0">
            <tr>
              <td>
                <p style="margin:0 0 4px;font-size:11px;font-weight:700;color:${RETURNED_COLOR};text-transform:uppercase;letter-spacing:0.06em;">Sent Back for Changes</p>
                <p style="margin:0;font-size:14px;color:#0f172a;line-height:1.5;">
                  Returned from <strong>${escapeHtml(input.returnedFromStepName)}</strong>${input.actorName ? ` by <strong>${escapeHtml(input.actorName)}</strong>` : ''}.
                </p>
              </td>
              <td align="right" valign="top">${returnsBadge}</td>
            </tr>
          </table>
        </td>
      </tr>
    </table>`;

  const commentMarkup = input.comment
    ? commentBlock('Reviewer comment', input.comment, RETURNED_COLOR)
    : '';

  const body = `
      <p style="margin:0 0 18px;font-size:14px;color:#334155;line-height:1.6;">
        Hi ${escapeHtml(input.requesterName || 'there')}, your <strong>${escapeHtml(ctx.label.toLowerCase())}</strong> has been returned for revisions.
      </p>
      ${returnedBanner}
      ${detailsTable}
      ${commentMarkup}
      ${cta.html}`;

  const html = emailShell({
    module: ctx.module,
    accentColor: RETURNED_COLOR,
    statusIcon: '↩️',
    statusText: `${ctx.label} Returned`,
    greeting: `Hi ${escapeHtml(input.requesterName || 'there')},`,
    body,
    footerNote:
      'Please review the comments above, make the necessary changes, and resubmit your request.',
  });

  const text = `Your ${ctx.label.toLowerCase()} was returned for changes from "${input.returnedFromStepName}"${input.actorName ? ` by ${input.actorName}` : ''}.${input.comment ? `\n\nComment: ${input.comment}` : ''}${cta.text}`;

  return {
    to: input.requesterEmail,
    subject: `${ctx.label} Returned — Changes Requested`,
    html,
    text,
  };
}
