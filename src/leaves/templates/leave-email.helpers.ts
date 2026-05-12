// ---------------------------------------------------------------------------
// Shared helpers for leave email templates
// ---------------------------------------------------------------------------

export function escapeHtmlText(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function vaultDeepLinkBlock(
  url: string,
  buttonLabel: string,
): { html: string; text: string } {
  const safeHref = escapeHtmlText(url);
  const safeLabel = escapeHtmlText(buttonLabel);
  const html = `
      <p style="margin:24px 0 0;text-align:center;">
        <a href="${safeHref}" style="display:inline-block;padding:12px 24px;background:#6366f1;color:#ffffff;text-decoration:none;border-radius:8px;font-size:14px;font-weight:600;">${safeLabel}</a>
      </p>
      <p style="margin:12px 0 0;font-size:11px;color:#94a3b8;text-align:center;word-break:break-all;line-height:1.4;">${safeHref}</p>
    `;
  const text = `\n\n${buttonLabel} (sign in if needed): ${url}`;
  return { html, text };
}

export function fmtLeaveType(raw: string): string {
  return raw.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export function isWfhType(leaveType: string): boolean {
  const t = leaveType.toUpperCase();
  return t === 'WORK_FROM_HOME' || t === 'WFH';
}

export function requestLabel(leaveType: string): string {
  return isWfhType(leaveType) ? 'WFH request' : 'leave request';
}

export function requestLabelCap(leaveType: string): string {
  return isWfhType(leaveType) ? 'WFH Request' : 'Leave Request';
}

export function detailRow(label: string, value: string, shade = false): string {
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

export function commentBlock(label: string, comment: string, color: string): string {
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

export function alertBanner(text: string, subtext: string): string {
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

export function emailShell(opts: {
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
