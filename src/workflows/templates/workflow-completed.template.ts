import { getFrontendUrl } from '../../common/utils/frontend-url';
import {
  buildRequestDetailRows,
  buildRequesterUrl,
  commentBlock,
  ctaButton,
  emailShell,
  escapeHtml,
  getRequestTypeContext,
  WorkflowEmailMetadataView,
  WorkflowResolutionKind,
} from './workflow-email.helpers';
import type { RenderedEmail } from './workflow-step-pending.template';

export interface WorkflowCompletedInput {
  requesterName: string;
  requesterEmail: string;
  requestType: string;
  requestId: string;
  resolution: WorkflowResolutionKind;
  reason?: string | null;
  finalActorName?: string | null;
  finalComment?: string | null;
  metadata: WorkflowEmailMetadataView;
}

interface ResolutionTheme {
  statusText: string;
  accentColor: string;
  icon: string;
  intro: (label: string) => string;
  footer: string;
  subjectVerb: string;
}

function themeFor(resolution: WorkflowResolutionKind, ctxLabel: string): ResolutionTheme {
  switch (resolution) {
    case 'APPROVED':
      return {
        statusText: `${ctxLabel} Approved`,
        accentColor: '#22c55e',
        icon: '✅',
        intro: (label) =>
          `Your <strong>${escapeHtml(label.toLowerCase())}</strong> has been <strong style="color:#16a34a;">approved</strong>.`,
        footer: 'Log in to <strong>Devsloop Vault</strong> to view the full approval trail.',
        subjectVerb: 'Approved',
      };
    case 'REJECTED':
      return {
        statusText: `${ctxLabel} Rejected`,
        accentColor: '#ef4444',
        icon: '❌',
        intro: (label) =>
          `Your <strong>${escapeHtml(label.toLowerCase())}</strong> has been <strong style="color:#dc2626;">rejected</strong>.`,
        footer:
          'If you have questions about this decision, please reach out to HR or your reporting manager.',
        subjectVerb: 'Rejected',
      };
    case 'CANCELLED':
      return {
        statusText: `${ctxLabel} Cancelled`,
        accentColor: '#94a3b8',
        icon: '⊘',
        intro: (label) =>
          `Your <strong>${escapeHtml(label.toLowerCase())}</strong> has been <strong style="color:#475569;">cancelled</strong>.`,
        footer: 'You can submit a new request from <strong>Devsloop Vault</strong> at any time.',
        subjectVerb: 'Cancelled',
      };
  }
}

export function workflowCompletedTemplate(input: WorkflowCompletedInput): RenderedEmail {
  const ctx = getRequestTypeContext(input.requestType, input.metadata);
  const theme = themeFor(input.resolution, ctx.label);

  const cta = ctaButton(
    `${getFrontendUrl()}${buildRequesterUrl(ctx, input.requestId)}`,
    `View ${ctx.label}`,
    theme.accentColor,
  );

  const detailsTable = buildRequestDetailRows({
    requestType: input.requestType,
    requesterName: input.requesterName,
    ctx,
    metadata: input.metadata,
  });

  const reasonNote = input.reason
    ? `<p style="margin:14px 0 0;font-size:13px;color:#64748b;line-height:1.6;"><em>Reason:</em> ${escapeHtml(input.reason)}</p>`
    : '';

  const finalCommentBlock = input.finalComment
    ? commentBlock(
        input.finalActorName ? `Comment from ${input.finalActorName}` : 'Comment',
        input.finalComment,
        theme.accentColor,
      )
    : '';

  const body = `
      <p style="margin:0 0 18px;font-size:14px;color:#334155;line-height:1.6;">
        ${theme.intro(ctx.label)}
      </p>
      ${detailsTable}
      ${finalCommentBlock}
      ${reasonNote}
      ${cta.html}`;

  const html = emailShell({
    module: ctx.module,
    accentColor: theme.accentColor,
    statusIcon: theme.icon,
    statusText: theme.statusText,
    greeting: `Hi ${escapeHtml(input.requesterName || 'there')},`,
    body,
    footerNote: theme.footer,
  });

  const text = `Your ${ctx.label.toLowerCase()} has been ${theme.subjectVerb.toLowerCase()}.${input.finalComment ? `\n\nComment: ${input.finalComment}` : ''}${cta.text}`;

  return {
    to: input.requesterEmail,
    subject: `${ctx.label} ${theme.subjectVerb}`,
    html,
    text,
  };
}
