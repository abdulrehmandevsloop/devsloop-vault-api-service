export function contactTemplate(data: { name: string; email: string; message: string }): string {
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:40px 20px;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;overflow:hidden;border:1px solid #e4e4e7;">
        <tr>
          <td style="background:#0A0F1C;padding:24px 32px;">
            <p style="margin:0;font-size:18px;font-weight:700;color:#00D4AA;">New Contact Form Submission</p>
            <p style="margin:4px 0 0;font-size:13px;color:rgba(255,255,255,0.5);">arslanihsan.com</p>
          </td>
        </tr>
        <tr>
          <td style="padding:32px;">
            <table width="100%" cellpadding="0" cellspacing="0">
              <tr>
                <td style="padding:10px 0;border-bottom:1px solid #f0f0f0;">
                  <span style="font-size:12px;font-weight:600;color:#71717a;text-transform:uppercase;letter-spacing:0.05em;">Name</span><br>
                  <span style="font-size:15px;color:#18181b;">${data.name}</span>
                </td>
              </tr>
              <tr>
                <td style="padding:10px 0;border-bottom:1px solid #f0f0f0;">
                  <span style="font-size:12px;font-weight:600;color:#71717a;text-transform:uppercase;letter-spacing:0.05em;">Email</span><br>
                  <a href="mailto:${data.email}" style="font-size:15px;color:#00D4AA;text-decoration:none;">${data.email}</a>
                </td>
              </tr>
              <tr>
                <td style="padding:10px 0;">
                  <span style="font-size:12px;font-weight:600;color:#71717a;text-transform:uppercase;letter-spacing:0.05em;">Message</span><br>
                  <p style="font-size:15px;color:#18181b;line-height:1.7;margin:6px 0 0;background:#f9f9f9;border-radius:6px;padding:14px;border-left:3px solid #00D4AA;">${data.message}</p>
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}
