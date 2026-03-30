import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { PgBossService } from 'src/queue/pg-boss.service';
import { AclService } from 'src/rbac/rbac.service';

interface ReimbursementData {
  employeeName: string;
  requestId: string;
  amount: number;
  type: string;
  description?: string;
  processingType?: string;
  salaryMonth?: string;
  hrComment?: string;
  hrName?: string;
  processingNotes?: string;
  bankName?: string;
  iban?: string;
}

@Injectable()
export class ReimbursementEmailHandler {
  private readonly logger = new Logger(ReimbursementEmailHandler.name);

  constructor(
    private readonly pgBossService: PgBossService,
    private readonly aclService: AclService,
  ) {}

  @OnEvent('reimbursement.created')
  async handleReimbursementCreated(payload: any) {
    const html = this.getCreatedEmailTemplate({
      employeeName: payload.reimbursement.employee.name,
      requestId: payload.reimbursement.id,
      amount: payload.reimbursement.amount,
      type: payload.reimbursement.reimbursementType,
      description: payload.reimbursement.description,
    });

    await this.sendEmailToUsersWithEntityAccess('user', 'Reimbursement Request Submitted', html);
  }

  @OnEvent('reimbursement.approved')
  async handleReimbursementApproved(payload: any) {
    const employeeHtml = this.getApprovedEmailTemplate({
      employeeName: payload.reimbursement.employee.name,
      requestId: payload.reimbursement.id,
      amount: payload.reimbursement.amount,
      type: payload.reimbursement.reimbursementType,
      processingType: payload.reimbursement.processingType,
      salaryMonth: payload.reimbursement.salaryMonth,
      hrComment: payload.reimbursement.hrComment,
    });

    // Notify employee
    await this.pgBossService.sendToQueue('email-notification', {
      to: payload.reimbursement.employee.email,
      subject: 'Reimbursement Request Approved',
      html: employeeHtml,
    });
  }

  @OnEvent('reimbursement.rejected')
  async handleReimbursementRejected(payload: any) {
    const employeeHtml = this.getRejectedEmailTemplate({
      employeeName: payload.reimbursement.employee.name,
      requestId: payload.reimbursement.id,
      amount: payload.reimbursement.amount,
      type: payload.reimbursement.reimbursementType,
      hrComment: payload.reimbursement.hrComment,
    });

    // Notify employee
    await this.pgBossService.sendToQueue('email-notification', {
      to: payload.reimbursement.employee.email,
      subject: 'Reimbursement Request Rejected',
      html: employeeHtml,
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
   * Send email to all users with specific entity permission
   */
  private async sendEmailToUsersWithEntityAccess(
    entityName: string,
    subject: string,
    html: string,
  ): Promise<void> {
    try {
      const usersWithAccess = await this.aclService.getUsersWithEntityAccess(entityName);

      // Send email to each user with the required permission
      for (const user of usersWithAccess) {
        await this.pgBossService.sendToQueue('email-notification', {
          to: user.email,
          subject,
          html,
        });
      }

      this.logger.log(
        `Sent "${subject}" email to ${usersWithAccess.length} users with ${entityName} permission`,
      );
    } catch (error) {
      this.logger.error(`Failed to send email to users with ${entityName} permission:`, error);
    }
  }

  /**
   * Get created email template
   */
  private getCreatedEmailTemplate(data: ReimbursementData): string {
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
              color: #2196F3;
              margin: 0;
              font-size: 28px;
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
              <h1>📋 Reimbursement Request Submitted</h1>
            </div>
            
            <p>Reimbursement request has been <strong>successfully submitted</strong> and is now pending review by the HR team.</p>
            
            <div class="info-box">
              <p><strong>Request ID:</strong> ${this.escapeHtml(data.requestId)}</p>
              <p><strong>Type:</strong> ${this.escapeHtml(data.type)}</p>
              <p><strong>Amount:</strong> Rs. ${data.amount.toLocaleString('en-PK')}</p>
              ${data.description ? `<p><strong>Description:</strong> ${this.escapeHtml(data.description)}</p>` : ''}
            </div>
          </div>
        </body>
      </html>
    `;
  }

  /**
   * Get approved email template for employee
   */
  private getApprovedEmailTemplate(data: ReimbursementData): string {
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
              color: #4CAF50;
              margin: 0;
              font-size: 28px;
            }
            .success-badge {
              background: #E8F5E9;
              border: 2px solid #4CAF50;
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
              color: #2E7D32;
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
              background: #E8F5E9;
              border-left: 4px solid #4CAF50;
              padding: 15px;
              margin: 20px 0;
              border-radius: 4px;
            }
            .comment-box .label {
              font-weight: bold;
              color: #2E7D32;
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
              <h1>🎉 Reimbursement Request Approved!</h1>
            </div>
            
            <div class="success-badge">
              <div class="icon">✅</div>
              <div class="text">Your request has been approved!</div>
            </div>
            
            <p>Great news! Your reimbursement request has been <strong>approved</strong> by the HR team.</p>
            
            <div class="info-box">
              <p><strong>Request ID:</strong> ${this.escapeHtml(data.requestId)}</p>
              <p><strong>Type:</strong> ${this.escapeHtml(data.type)}</p>
              <p><strong>Amount:</strong> Rs. ${data.amount.toLocaleString('en-PK')}</p>
              <p><strong>Processing Type:</strong> ${this.escapeHtml(this.formatProcessingType(data.processingType))}</p>
              ${data.salaryMonth ? `<p><strong>Salary Month:</strong> ${this.escapeHtml(data.salaryMonth)}</p>` : ''}
            </div>
            
            ${
              data.hrComment
                ? `
              <div class="comment-box">
                <span class="label">HR Comment:</span>
                <div>${this.escapeHtml(data.hrComment)}</div>
              </div>
            `
                : ''
            }
            
            <p>Your reimbursement will be processed according to the selected processing type.</p>
            
            <div class="footer">
              <p>This is an automated email from DevsLoop Vault.</p>
              <p>If you have any questions, please contact HR.</p>
            </div>
          </div>
        </body>
      </html>
    `;
  }

  /**
   * Get rejected email template for employee
   */
  private getRejectedEmailTemplate(data: ReimbursementData): string {
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
              color: #F44336;
              margin: 0;
              font-size: 28px;
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
              background: #FFEBEE;
              border-left: 4px solid #F44336;
              padding: 15px;
              margin: 20px 0;
              border-radius: 4px;
            }
            .comment-box .label {
              font-weight: bold;
              color: #C62828;
              margin-bottom: 10px;
              display: block;
            }
            .comment-box .comment {
              color: #333;
              white-space: pre-wrap;
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
              <h1>❌ Reimbursement Request Rejected</h1>
            </div>
            
            <p>Your reimbursement request has been <strong>reviewed and rejected</strong> by the HR team.</p>
            
            <div class="info-box">
              <p><strong>Request ID:</strong> ${this.escapeHtml(data.requestId)}</p>
              <p><strong>Type:</strong> ${this.escapeHtml(data.type)}</p>
              <p><strong>Amount:</strong> Rs. ${data.amount.toLocaleString('en-PK')}</p>
            </div>
            
            ${
              data.hrComment
                ? `
              <div class="comment-box">
                <span class="label">Reason for Rejection:</span>
                <div class="comment">${this.escapeHtml(data.hrComment)}</div>
              </div>
            `
                : ''
            }
            
            <p>If you have questions about this decision or would like to discuss further, please contact the HR team.</p>
            
            <div class="footer">
              <p>This is an automated email from DevsLoop Vault.</p>
              <p>If you have any questions, please contact HR.</p>
            </div>
          </div>
        </body>
      </html>
    `;
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
              <p><strong>Request ID:</strong> ${this.escapeHtml(data.requestId)}</p>
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
