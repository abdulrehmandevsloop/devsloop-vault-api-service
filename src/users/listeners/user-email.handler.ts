import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { UserApprovedEvent, UserRejectedEvent } from '../events';
import { PgBossService } from '../../queue/pg-boss.service';

@Injectable()
export class UserEmailHandler {
  private readonly logger = new Logger(UserEmailHandler.name);

  constructor(private readonly pgBossService: PgBossService) {}

  @OnEvent('user.approved', { async: true })
  async handleUserApproved(event: UserApprovedEvent) {
    this.logger.log(`Queueing approval email for ${event.email}`);

    await this.pgBossService.sendToQueue(
      'email-welcome',
      {
        to: event.email,
        subject: 'DevsLoop Vault - Account Approved! 🎉',
        html: `
        <h1>Welcome to DevsLoop Vault, ${event.name}!</h1>
        <p>Great news! Your account has been approved.</p>
        <p>You now have full access to the DevsLoop Vault platform.</p>
        <p>Start contributing to projects and sharing your knowledge!</p>
        <a href="${process.env.FRONTEND_URL || 'http://localhost:3000'}/dashboard">Go to Dashboard</a>
      `,
      },
      {
        retryLimit: 3,
        retryDelay: 2000,
        retryBackoff: true,
      },
    );
  }

  @OnEvent('user.rejected', { async: true })
  async handleUserRejected(event: UserRejectedEvent) {
    this.logger.log(`Queueing rejection email for ${event.email}`);

    await this.pgBossService.sendToQueue('email-notification', {
      to: event.email,
      subject: 'DevsLoop Vault - Account Status Update',
      html: `
        <h1>Account Review Update</h1>
        <p>Dear ${event.name},</p>
        <p>Thank you for your interest in DevsLoop Vault.</p>
        <p>After careful review, we are unable to approve your account at this time.</p>
        ${event.reason ? `<p><strong>Reason:</strong> ${event.reason}</p>` : ''}
        <p>If you have any questions, please contact our support team.</p>
      `,
    });
  }
}
