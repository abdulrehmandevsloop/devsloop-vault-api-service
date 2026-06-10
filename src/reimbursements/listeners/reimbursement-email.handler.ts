import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { PgBossService } from 'src/queue/pg-boss.service';

interface ReimbursementData {
  employeeName: string;
  requestId: string;
  amount: number;
  type: string;
  description?: string;
  processingType?: string;
  processingNotes?: string;
}

/** Prisma Decimal columns surface as objects with `toNumber()`; events may also carry plain numbers. */
type DecimalOrNumber = number | { toNumber(): number };

function toAmount(value: DecimalOrNumber | null | undefined, fallback = 0): number {
  if (value == null) return fallback;
  return typeof value === 'number' ? value : value.toNumber();
}

interface InstallmentInfo {
  installmentNo: number;
  scheduledMonth: string;
  amount: DecimalOrNumber;
  processedBy?: { name?: string | null } | null;
}

interface ReimbursementRef {
  employee: { name: string; email: string };
  approvedAmount?: DecimalOrNumber | null;
  amount?: DecimalOrNumber | null;
  totalInstallments?: number;
  installments?: InstallmentInfo[];
}

interface InstallmentPlanCreatedPayload {
  reimbursement: ReimbursementRef;
}

interface InstallmentProcessedPayload {
  installment: InstallmentInfo;
  reimbursement: ReimbursementRef;
  processedCount: number;
  totalInstallments: number;
}

// ---------------------------------------------------------------------------
// Email layout helpers
// ---------------------------------------------------------------------------

function escapeHtml(str: string): string {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function fmtPKR(amount: number): string {
  return `Rs. ${Number(amount).toLocaleString('en-PK', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })}`;
}

function fmtYearMonth(ym: string): string {
  const MONTHS = [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December',
  ];
  const [year, month] = ym.split('-').map(Number);
  return `${MONTHS[month - 1]} ${year}`;
}

function detailRow(label: string, value: string, shade = false): string {
  const bg = shade ? 'background:#f8fafc;' : 'background:#ffffff;';
  return `
    <tr>
      <td style="${bg}padding:10px 20px;border-bottom:1px solid #f1f5f9;width:38%;vertical-align:top;">
        <span style="font-size:12px;font-weight:600;color:#94a3b8;text-transform:uppercase;letter-spacing:0.05em;">${label}</span>
      </td>
      <td style="${bg}padding:10px 20px;border-bottom:1px solid #f1f5f9;vertical-align:top;">
        <span style="font-size:14px;color:#1e293b;">${value}</span>
      </td>
    </tr>`;
}

function emailShell(opts: {
  accentColor: string;
  statusIcon: string;
  statusText: string;
  greeting: string;
  body: string;
  footerNote?: string;
  module?: string;
}): string {
  const {
    accentColor,
    statusIcon,
    statusText,
    greeting,
    body,
    footerNote,
    module: mod = 'Reimbursements',
  } = opts;
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
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td>
                    <span style="font-size:22px;line-height:1;">${statusIcon}</span>
                    <span style="font-size:16px;font-weight:700;color:#ffffff;margin-left:10px;vertical-align:middle;">${escapeHtml(statusText)}</span>
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

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

/**
 * Email handler for non-workflow reimbursement lifecycle events.
 *
 * Workflow-aligned events (created, approved, rejected, returned, cancelled)
 * are now emailed by [workflow-notification.handler.ts](src/workflows/listeners/workflow-notification.handler.ts).
 * This handler retains the post-approval lifecycle events that have no
 * workflow analogue: HR processing, installment plan creation, and per-
 * installment disbursement.
 */
@Injectable()
export class ReimbursementEmailHandler {
  private readonly logger = new Logger(ReimbursementEmailHandler.name);

  constructor(private readonly pgBossService: PgBossService) {}

  // ── Installment plan created → notify employee ───────────────────────────

  @OnEvent('reimbursement.installment_plan_created')
  async handleInstallmentPlanCreated(payload: InstallmentPlanCreatedPayload) {
    const r = payload.reimbursement;
    const employeeName = escapeHtml(r.employee.name);
    const approvedAmount: number = toAmount(r.approvedAmount ?? r.amount);
    const totalInstallments: number = r.totalInstallments ?? 0;
    const installments: InstallmentInfo[] = Array.isArray(r.installments) ? r.installments : [];

    const perInstallmentApprox =
      totalInstallments > 0
        ? fmtPKR(Math.floor((approvedAmount / totalInstallments) * 100) / 100)
        : '—';

    // Build schedule table rows
    const scheduleRows = [...installments]
      .sort((a, b) => a.installmentNo - b.installmentNo)
      .map((inst, idx) => {
        const shade = idx % 2 !== 0;
        const bg = shade ? '#f8fafc' : '#ffffff';
        return `<tr>
          <td style="background:${bg};padding:11px 16px;border-bottom:1px solid #f1f5f9;text-align:center;font-size:13px;color:#64748b;font-weight:600;">${inst.installmentNo}</td>
          <td style="background:${bg};padding:11px 16px;border-bottom:1px solid #f1f5f9;font-size:14px;color:#1e293b;">${escapeHtml(fmtYearMonth(inst.scheduledMonth))}</td>
          <td style="background:${bg};padding:11px 16px;border-bottom:1px solid #f1f5f9;text-align:right;font-size:14px;color:#0f172a;font-weight:600;">${escapeHtml(fmtPKR(toAmount(inst.amount)))}</td>
          <td style="background:${bg};padding:11px 16px;border-bottom:1px solid #f1f5f9;text-align:center;">
            <span style="display:inline-block;padding:2px 10px;border-radius:999px;font-size:11px;font-weight:600;background:#fef3c7;color:#92400e;border:1px solid #fde68a;">Pending</span>
          </td>
        </tr>`;
      })
      .join('');

    // Totals footer row
    const totalRow = `<tr>
      <td colspan="2" style="background:#f8fafc;padding:11px 16px;border-top:2px solid #e2e8f0;font-size:13px;font-weight:700;color:#475569;text-transform:uppercase;letter-spacing:0.04em;">Total</td>
      <td style="background:#f8fafc;padding:11px 16px;border-top:2px solid #e2e8f0;text-align:right;font-size:14px;font-weight:700;color:#0f172a;">${escapeHtml(fmtPKR(approvedAmount))}</td>
      <td style="background:#f8fafc;border-top:2px solid #e2e8f0;"></td>
    </tr>`;

    const body = `
      <p style="margin:0 0 20px;font-size:14px;color:#334155;line-height:1.7;">
        Your reimbursement has been approved and a
        <strong style="color:#1e293b;">payment schedule of ${totalInstallments} monthly installments</strong>
        has been set up. The total approved amount of
        <strong style="color:#1e293b;">${escapeHtml(fmtPKR(approvedAmount))}</strong>
        will be disbursed as per the schedule below.
      </p>

      <!-- Summary tiles -->
      <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
        <tr>
          <td width="50%" style="padding-right:6px;">
            <table width="100%" cellpadding="0" cellspacing="0" style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;padding:14px 16px;">
              <tr>
                <td>
                  <p style="margin:0 0 4px;font-size:11px;font-weight:700;color:#3b82f6;text-transform:uppercase;letter-spacing:0.06em;">Total Approved</p>
                  <p style="margin:0;font-size:18px;font-weight:700;color:#1e3a8a;">${escapeHtml(fmtPKR(approvedAmount))}</p>
                </td>
              </tr>
            </table>
          </td>
          <td width="50%" style="padding-left:6px;">
            <table width="100%" cellpadding="0" cellspacing="0" style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:14px 16px;">
              <tr>
                <td>
                  <p style="margin:0 0 4px;font-size:11px;font-weight:700;color:#16a34a;text-transform:uppercase;letter-spacing:0.06em;">~Per Installment</p>
                  <p style="margin:0;font-size:18px;font-weight:700;color:#14532d;">${escapeHtml(perInstallmentApprox)}</p>
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>

      <!-- Payment schedule table -->
      <p style="margin:0 0 10px;font-size:12px;font-weight:700;color:#475569;text-transform:uppercase;letter-spacing:0.06em;">Payment Schedule</p>
      <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;margin-bottom:8px;">
        <thead>
          <tr style="background:#f1f5f9;">
            <th style="padding:10px 16px;text-align:center;font-size:11px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:0.05em;border-bottom:1px solid #e2e8f0;width:10%;">#</th>
            <th style="padding:10px 16px;text-align:left;font-size:11px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:0.05em;border-bottom:1px solid #e2e8f0;">Month</th>
            <th style="padding:10px 16px;text-align:right;font-size:11px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:0.05em;border-bottom:1px solid #e2e8f0;">Amount</th>
            <th style="padding:10px 16px;text-align:center;font-size:11px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:0.05em;border-bottom:1px solid #e2e8f0;">Status</th>
          </tr>
        </thead>
        <tbody>
          ${scheduleRows || `<tr><td colspan="4" style="padding:16px;text-align:center;color:#94a3b8;font-size:13px;">No installments found</td></tr>`}
        </tbody>
        <tfoot>
          ${totalRow}
        </tfoot>
      </table>`;

    const html = emailShell({
      accentColor: '#3b82f6',
      statusIcon: '💳',
      statusText: 'Installment Plan Confirmed',
      greeting: `Hi ${employeeName},`,
      body,
      footerNote:
        'Each installment will be processed on its scheduled month. Log in to <strong>Devsloop Vault</strong> to track your payment progress.',
    });

    await this.pgBossService.sendToQueue('email-notification', {
      to: r.employee.email,
      subject: `Installment Plan Created — ${escapeHtml(fmtPKR(approvedAmount))} in ${totalInstallments} payments`,
      html,
    });
  }

  // ── Individual installment paid → notify employee ───────────────────────

  @OnEvent('reimbursement.installment_processed')
  async handleInstallmentProcessed(payload: InstallmentProcessedPayload) {
    const { installment, reimbursement, processedCount, totalInstallments } = payload;
    const r = reimbursement;
    const inst = installment;

    const employeeName = escapeHtml(r.employee.name);
    const paidAmount: number = toAmount(inst.amount);
    const totalApproved: number = toAmount(r.approvedAmount ?? r.amount);

    const remaining = totalInstallments - processedCount;
    const progressPct =
      totalInstallments > 0 ? Math.round((processedCount / totalInstallments) * 100) : 0;
    const isLastInstallment = remaining === 0;

    // Progress bar (inline HTML — 200px wide, filled portion in green)
    const filledWidth = Math.round((progressPct / 100) * 200);
    const progressBar = `
      <table cellpadding="0" cellspacing="0" style="margin:16px 0;">
        <tr>
          <td>
            <table cellpadding="0" cellspacing="0" style="background:#e2e8f0;border-radius:999px;width:200px;height:8px;overflow:hidden;">
              <tr>
                <td style="background:#22c55e;width:${filledWidth}px;height:8px;border-radius:999px;"></td>
                <td style="width:${200 - filledWidth}px;"></td>
              </tr>
            </table>
          </td>
          <td style="padding-left:10px;">
            <span style="font-size:13px;font-weight:600;color:#16a34a;">${processedCount}/${totalInstallments} paid (${progressPct}%)</span>
          </td>
        </tr>
      </table>`;

    const statusBlock = isLastInstallment
      ? `<table width="100%" cellpadding="0" cellspacing="0" style="margin:20px 0 0;">
          <tr>
            <td style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:14px 16px;">
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td width="28" style="vertical-align:top;padding-top:1px;"><span style="font-size:18px;">🎉</span></td>
                  <td style="padding-left:8px;">
                    <p style="margin:0 0 2px;font-size:13px;font-weight:700;color:#15803d;">All installments paid!</p>
                    <p style="margin:0;font-size:12px;color:#16a34a;line-height:1.5;">Your reimbursement is now fully processed. Thank you!</p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>`
      : `<table width="100%" cellpadding="0" cellspacing="0" style="margin:20px 0 0;">
          <tr>
            <td style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;padding:12px 16px;">
              <p style="margin:0;font-size:13px;color:#1d4ed8;line-height:1.5;">
                <strong>${remaining} installment${remaining > 1 ? 's' : ''} remaining.</strong>
                Each will be processed on its scheduled month.
              </p>
            </td>
          </tr>
        </table>`;

    const body = `
      <p style="margin:0 0 20px;font-size:14px;color:#334155;line-height:1.7;">
        Installment <strong style="color:#1e293b;">#${inst.installmentNo}</strong>
        for <strong style="color:#1e293b;">${escapeHtml(fmtYearMonth(inst.scheduledMonth))}</strong>
        has been processed and the payment has been disbursed.
      </p>

      <!-- Details table -->
      <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;margin-bottom:20px;">
        ${detailRow('Installment', `#${inst.installmentNo} of ${totalInstallments}`)}
        ${detailRow('Payment Month', escapeHtml(fmtYearMonth(inst.scheduledMonth)), true)}
        ${detailRow('Amount Paid', escapeHtml(fmtPKR(paidAmount)))}
        ${detailRow('Total Approved', escapeHtml(fmtPKR(totalApproved)), true)}
        ${detailRow('Processed By', escapeHtml(inst.processedBy?.name ?? 'HR'))}
      </table>

      <!-- Progress -->
      <p style="margin:0 0 6px;font-size:12px;font-weight:700;color:#475569;text-transform:uppercase;letter-spacing:0.06em;">Payment Progress</p>
      ${progressBar}
      ${statusBlock}`;

    const html = emailShell({
      accentColor: '#22c55e',
      statusIcon: '✅',
      statusText: `Installment #${inst.installmentNo} Paid`,
      greeting: `Hi ${employeeName},`,
      body,
      footerNote: 'Log in to <strong>Devsloop Vault</strong> to view your full payment schedule.',
    });

    await this.pgBossService.sendToQueue('email-notification', {
      to: r.employee.email,
      subject: `Installment #${inst.installmentNo} Paid — ${escapeHtml(fmtPKR(paidAmount))} (${processedCount}/${totalInstallments} complete)`,
      html,
    });
  }

  @OnEvent('reimbursement.processed')
  async handleReimbursementProcessed(payload: any) {
    const employeeHtml = this.getProcessedEmailTemplate({
      employeeName: payload.reimbursement.employee.name,
      requestId: payload.reimbursement.id,
      amount: payload.reimbursement.amount,
      type: payload.reimbursement.reimbursementType,
      processingType: payload.reimbursement.processingType,
      processingNotes: payload.reimbursement.processingNotes,
    });

    // Notify employee
    await this.pgBossService.sendToQueue('email-notification', {
      to: payload.reimbursement.employee.email,
      subject: 'Reimbursement Request Processed',
      html: employeeHtml,
    });
  }

  /**
   * Get processed email template
   */
  private getProcessedEmailTemplate(data: ReimbursementData): string {
    return `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <style>
            body {
              font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
              line-height: 1.6;
              color: #333;
              max-width: 600px;
              margin: 0 auto;
              padding: 20px;
              background-color: #f4f4f4;
            }
            .container {
              background: white;
              padding: 40px;
              border-radius: 10px;
              box-shadow: 0 2px 10px rgba(0,0,0,0.1);
            }
            .header {
              text-align: center;
              margin-bottom: 30px;
            }
            .header h1 {
              color: #9C27B0;
              margin: 0;
              font-size: 28px;
            }
            .success-badge {
              background: #F3E5F5;
              border: 2px solid #9C27B0;
              border-radius: 8px;
              padding: 20px;
              text-align: center;
              margin: 30px 0;
            }
            .success-badge .icon {
              font-size: 48px;
              margin-bottom: 10px;
            }
            .success-badge .text {
              font-size: 18px;
              font-weight: bold;
              color: #6A1B9A;
            }
            .info-box {
              background: #f8f9fa;
              border-left: 4px solid #2196F3;
              padding: 15px;
              margin: 20px 0;
              border-radius: 4px;
            }
            .info-box p {
              margin: 5px 0;
            }
            .comment-box {
              background: #F3E5F5;
              border-left: 4px solid #9C27B0;
              padding: 15px;
              margin: 20px 0;
              border-radius: 4px;
            }
            .comment-box .label {
              font-weight: bold;
              color: #6A1B9A;
              margin-bottom: 10px;
              display: block;
            }
            .footer {
              text-align: center;
              margin-top: 30px;
              padding-top: 20px;
              border-top: 1px solid #e0e0e0;
              color: #999;
              font-size: 12px;
            }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>💰 Reimbursement Processed</h1>
            </div>
            
            <div class="success-badge">
              <div class="icon">✅</div>
              <div class="text">Your reimbursement has been processed!</div>
            </div>
            
            <p>Your reimbursement request has been <strong>successfully processed</strong> and the payment has been initiated.</p>
            
            <div class="info-box">
              <p><strong>Type:</strong> ${this.escapeHtml(data.type)}</p>
              <p><strong>Amount:</strong> Rs. ${data.amount.toLocaleString('en-PK')}</p>
              <p><strong>Processing Type:</strong> ${this.escapeHtml(this.formatProcessingType(data.processingType))}</p>
            </div>
            
            ${
              data.processingNotes
                ? `
              <div class="comment-box">
                <span class="label">Processing Notes:</span>
                <div>${this.escapeHtml(data.processingNotes)}</div>
              </div>
            `
                : ''
            }
            
            <p>Thank you for your patience. The funds should be reflected according to the selected processing method.</p>
            
            <div class="footer">
              <p>This is an automated email from DevsLoop Vault.</p>
              <p>If you have any questions, please contact HR or Finance.</p>
            </div>
          </div>
        </body>
      </html>
    `;
  }

  /**
   * Format processing type from snake_case to Title Case
   */
  private formatProcessingType(processingType?: string): string {
    if (!processingType) return 'N/A';

    return processingType
      .split('_')
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join(' ');
  }

  /**
   * Escape HTML to prevent XSS
   */
  private escapeHtml(text: string): string {
    const map: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;',
    };
    return text.replace(/[&<>"']/g, (m) => map[m]);
  }
}
