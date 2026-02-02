import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OnEvent } from '@nestjs/event-emitter';
import {
  ContributionSubmittedEvent,
  ContributionApprovedEvent,
  ContributionRejectedEvent,
} from '../events';
import { PgBossService } from '../../queue/pg-boss.service';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class ContributionEmailHandler {
  private readonly logger = new Logger(ContributionEmailHandler.name);

  constructor(
    private readonly pgBossService: PgBossService,
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  @OnEvent('contribution.submitted', { async: true })
  async handleContributionSubmitted(event: ContributionSubmittedEvent) {
    this.logger.log(`Queueing submission confirmation email for ${event.authorEmail}`);

    await this.pgBossService.sendToQueue('email-notification', {
      to: event.authorEmail,
      subject: 'DevsLoop Vault - Contribution Submitted',
      html: `
        <h1>Contribution Submitted Successfully</h1>
        <p>Your contribution for project "${event.projectName}" has been submitted for review.</p>
        <p>You will be notified once a reviewer processes your submission.</p>
        <p>Thank you for contributing to the knowledge base!</p>
      `,
    });

    const assignees = await this.prisma['userProject'].findMany({
      where: { projectId: event.projectId },
      select: { user: { select: { email: true } } },
    });

    const assigneeEmails = assignees
      .map((a) => a.user.email)
      .filter((email) => email !== event.authorEmail);

    const frontendUrl = this.configService.get<string>('FRONTEND_URL') || 'http://localhost:3000';
    const reviewLink = `${frontendUrl}/review-contributions/${event.contributionId}`;

    for (const to of assigneeEmails) {
      this.logger.log(`Queueing review-request email for project assignee: ${to}`);
      await this.pgBossService.sendToQueue('email-notification', {
        to,
        subject: 'DevsLoop Vault - New Contribution to Review',
        html: `
          <h1>New Contribution Added</h1>
          <p>A new contribution for project "<strong>${event.projectName}</strong>" has been submitted and is awaiting review.</p>
          <p><a href="${reviewLink}">Review the contribution</a></p>
          <p>Thank you!</p>
        `,
      });
    }
  }

  @OnEvent('contribution.approved', { async: true })
  async handleContributionApproved(event: ContributionApprovedEvent) {
    this.logger.log(`Queueing approval email for ${event.authorEmail}`);

    // Get contribution and project details for the email
    const contribution = await this.prisma.contribution.findUnique({
      where: { id: event.contributionId },
      select: {
        problem: true,
        project: {
          select: {
            name: true,
          },
        },
      },
    });

    const frontendUrl = this.configService.get<string>('FRONTEND_URL') || 'http://localhost:3000';
    const contributionLink = `${frontendUrl}/contributions/${event.contributionId}`;
    const projectName = contribution?.project?.name || 'the project';
    const problemPreview = contribution?.problem
      ? contribution.problem.substring(0, 100) + (contribution.problem.length > 100 ? '...' : '')
      : 'Your contribution';

    const commentHtml = event.reviewerComment
      ? `
        <div style="background: #e7f3ff; border-left: 4px solid #2196F3; padding: 15px; margin: 20px 0; border-radius: 4px;">
          <p style="margin: 0 0 10px 0; font-weight: bold; color: #1976D2;">Reviewer Comment:</p>
          <p style="margin: 0; color: #333;">${this.escapeHtml(event.reviewerComment)}</p>
        </div>
      `
      : '';

    const html = this.getApprovalEmailTemplate({
      reviewerName: event.reviewerName,
      projectName,
      problemPreview,
      contributionLink,
      commentHtml,
    });

    await this.pgBossService.sendToQueue('email-notification', {
      to: event.authorEmail,
      subject: 'DevsLoop Vault - Contribution Approved! 🎉',
      html,
    });
  }

  @OnEvent('contribution.rejected', { async: true })
  async handleContributionRejected(event: ContributionRejectedEvent) {
    this.logger.log(`Queueing rejection email for ${event.authorEmail}`);

    // Get contribution and project details for the email
    const contribution = await this.prisma.contribution.findUnique({
      where: { id: event.contributionId },
      select: {
        problem: true,
        project: {
          select: {
            name: true,
          },
        },
      },
    });

    const frontendUrl = this.configService.get<string>('FRONTEND_URL') || 'http://localhost:3000';
    const contributionLink = `${frontendUrl}/contributions/${event.contributionId}`;
    const projectName = contribution?.project?.name || 'the project';
    const problemPreview = contribution?.problem
      ? contribution.problem.substring(0, 100) + (contribution.problem.length > 100 ? '...' : '')
      : 'Your contribution';

    const html = this.getRejectionEmailTemplate({
      reviewerName: event.reviewerName,
      projectName,
      problemPreview,
      contributionLink,
      reviewerComment: event.reviewerComment,
    });

    await this.pgBossService.sendToQueue('email-notification', {
      to: event.authorEmail,
      subject: 'DevsLoop Vault - Contribution Needs Revision',
      html,
    });
  }

  /**
   * Get approval email template with professional styling
   */
  private getApprovalEmailTemplate(data: {
    reviewerName: string;
    projectName: string;
    problemPreview: string;
    contributionLink: string;
    commentHtml: string;
  }): string {
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
            .button {
              display: inline-block;
              background: #2196F3;
              color: white;
              padding: 12px 30px;
              text-decoration: none;
              border-radius: 5px;
              margin: 20px 0;
              font-weight: bold;
            }
            .button:hover {
              background: #1976D2;
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
              <h1>🎉 Contribution Approved!</h1>
            </div>
            
            <div class="success-badge">
              <div class="icon">✅</div>
              <div class="text">Your contribution has been approved!</div>
            </div>
            
            <p>Great news! Your contribution has been <strong>approved</strong> by <strong>${this.escapeHtml(data.reviewerName)}</strong>.</p>
            
            <div class="info-box">
              <p><strong>Project:</strong> ${this.escapeHtml(data.projectName)}</p>
              <p><strong>Contribution:</strong> ${this.escapeHtml(data.problemPreview)}</p>
            </div>
            
            ${data.commentHtml}
            
            <p>Your contribution is now part of the <strong>DevsLoop Vault</strong> knowledge base and will help your team learn and grow.</p>
            
            <div style="text-align: center;">
              <a href="${data.contributionLink}" class="button">View Contribution</a>
            </div>
            
            <p style="margin-top: 30px;">Keep up the great work! Your contributions make a difference.</p>
            
            <div class="footer">
              <p>This is an automated email from DevsLoop Vault.</p>
              <p>If you have any questions, please contact your administrator.</p>
            </div>
          </div>
        </body>
      </html>
    `;
  }

  /**
   * Get rejection email template with professional styling
   */
  private getRejectionEmailTemplate(data: {
    reviewerName: string;
    projectName: string;
    problemPreview: string;
    contributionLink: string;
    reviewerComment: string;
  }): string {
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
              color: #FF9800;
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
              background: #FFF3E0;
              border-left: 4px solid #FF9800;
              padding: 15px;
              margin: 20px 0;
              border-radius: 4px;
            }
            .comment-box .label {
              font-weight: bold;
              color: #E65100;
              margin-bottom: 10px;
              display: block;
            }
            .comment-box .comment {
              color: #333;
              white-space: pre-wrap;
            }
            .button {
              display: inline-block;
              background: #2196F3;
              color: white;
              padding: 12px 30px;
              text-decoration: none;
              border-radius: 5px;
              margin: 20px 0;
              font-weight: bold;
            }
            .button:hover {
              background: #1976D2;
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
              <h1>📝 Contribution Review Update</h1>
            </div>
            
            <p>Your contribution has been reviewed by <strong>${this.escapeHtml(data.reviewerName)}</strong>.</p>
            
            <div class="info-box">
              <p><strong>Project:</strong> ${this.escapeHtml(data.projectName)}</p>
              <p><strong>Contribution:</strong> ${this.escapeHtml(data.problemPreview)}</p>
            </div>
            
            <p>The contribution requires some <strong>revisions</strong> before it can be approved.</p>
            
            <div class="comment-box">
              <span class="label">Reviewer Feedback:</span>
              <div class="comment">${this.escapeHtml(data.reviewerComment)}</div>
            </div>
            
            <p>Please review the feedback above and submit an updated version. You can revert your contribution to draft, make the necessary changes, and resubmit it for review.</p>
            
            <div style="text-align: center;">
              <a href="${data.contributionLink}" class="button">View Contribution & Edit</a>
            </div>
            
            <p style="margin-top: 30px;">We appreciate your contribution and look forward to your updated submission!</p>
            
            <div class="footer">
              <p>This is an automated email from DevsLoop Vault.</p>
              <p>If you have any questions, please contact your administrator.</p>
            </div>
          </div>
        </body>
      </html>
    `;
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
