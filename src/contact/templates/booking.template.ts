export function bookingTemplate(data: {
  rows: Array<{ label: string; value: string }>;
  message: string;
}): string {
  const rowsHtml = data.rows
    .map(
      (r) => `<tr>
        <td style="padding:10px 0;border-bottom:1px solid #f0f0f0;vertical-align:top;width:140px;">
          <span style="font-size:12px;font-weight:600;color:#71717a;text-transform:uppercase;letter-spacing:0.05em;">${r.label}</span>
        </td>
        <td style="padding:10px 0 10px 16px;border-bottom:1px solid #f0f0f0;">
          <span style="font-size:15px;color:#18181b;">${r.value}</span>
        </td>
      </tr>`,
    )
    .join('');

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:40px 20px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;overflow:hidden;border:1px solid #e4e4e7;">
        <tr>
          <td style="background:#0A0F1C;padding:24px 32px;">
            <p style="margin:0;font-size:18px;font-weight:700;color:#00D4AA;">New Speaking Booking Inquiry</p>
            <p style="margin:4px 0 0;font-size:13px;color:rgba(255,255,255,0.5);">arslanihsan.com</p>
          </td>
        </tr>
        <tr>
          <td style="padding:32px;">
            <table width="100%" cellpadding="0" cellspacing="0">
              ${rowsHtml}
            </table>
            <p style="font-size:12px;font-weight:600;color:#71717a;text-transform:uppercase;letter-spacing:0.05em;margin:20px 0 8px;">Message</p>
            <p style="font-size:15px;color:#18181b;line-height:1.7;margin:0;background:#f9f9f9;border-radius:6px;padding:14px;border-left:3px solid #00D4AA;">${data.message}</p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}
