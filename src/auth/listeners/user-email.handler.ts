import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { PrismaService } from '../../prisma/prisma.service';
import { getFrontendUrl } from '../../common/utils/frontend-url';
import {
  UserRegisteredEvent,
  VerificationEmailRequestedEvent,
  PasswordResetRequestedEvent,
  PasswordChangedEvent,
} from '../events';
import { PgBossService } from '../../queue/pg-boss.service';
import * as bcrypt from 'bcryptjs';

@Injectable()
export class UserEmailHandler {
  private readonly logger = new Logger(UserEmailHandler.name);

  constructor(
    private readonly pgBossService: PgBossService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Generate and send verification email
   * Used by both registration and resend verification flows
   */
  private async sendVerificationEmail(
    email: string,
    name: string,
    isResend: boolean = false,
  ): Promise<void> {
    // Generate secure verification token using bcryptjs
    // Generate multiple salts and combine them for a longer token
    const salt1 = await bcrypt.genSalt(10);
    const salt2 = await bcrypt.genSalt(10);
    const salt3 = await bcrypt.genSalt(10);
    const verificationToken = (salt1 + salt2 + salt3).replace(/[^a-zA-Z0-9]/g, '').substring(0, 64);
    const tokenExpires = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

    // Hash token before storing
    const hashedToken = await bcrypt.hash(verificationToken, 10);

    // Store token in database
    await this.prisma.user.update({
      where: { email },
      data: {
        emailVerificationToken: hashedToken,
        emailVerificationExpires: tokenExpires,
      },
    });

    const verificationUrl = `${getFrontendUrl()}/verify-email?token=${verificationToken}&email=${encodeURIComponent(email)}`;

    const emailData = {
      to: email,
      subject: isResend
        ? 'DevsLoop Vault - Verify Your Email (Resent)'
        : 'Welcome to DevsLoop Vault - Verify Your Email',
      html: `
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
                color: #007bff;
                margin: 0;
                font-size: 28px;
              }
              .button {
                display: inline-block;
                padding: 12px 30px;
                background-color: #007bff;
                color: white;
                text-decoration: none;
                border-radius: 5px;
                margin: 20px 0;
                font-weight: bold;
              }
              .button:hover {
                background-color: #0056b3;
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
                <h1>${isResend ? 'Verify Your Email' : `Welcome ${name}!`}</h1>
              </div>
              <p>${isResend ? 'You requested a new verification email.' : 'Thank you for registering with DevsLoop Vault.'}</p>
              <p>Please verify your email address by clicking the button below:</p>
              <div style="text-align: center;">
                <a href="${verificationUrl}" class="button">Verify Email</a>
              </div>
              <p style="color: #666; font-size: 14px; margin-top: 20px;">
                Or copy and paste this link into your browser:<br>
                <a href="${verificationUrl}" style="color: #007bff; word-break: break-all;">${verificationUrl}</a>
              </p>
              <p style="color: #999; font-size: 12px; margin-top: 30px;">
                This verification link will expire in 24 hours.
              </p>
              <p style="color: #999; font-size: 12px;">
                If you didn't ${isResend ? 'request this email' : 'create an account'}, please ignore this email.
              </p>
              <div class="footer">
                <p>© ${new Date().getFullYear()} DevsLoop Vault. All rights reserved.</p>
              </div>
            </div>
          </body>
        </html>
      `,
    };

    // Log email data before queueing
    this.logger.debug(`Queueing ${isResend ? 'resend' : 'verification'} email for ${email}`);

    await this.pgBossService.sendToQueue('email-verification', emailData);
  }

  @OnEvent('user.registered', { async: true })
  async handleUserRegistered(event: UserRegisteredEvent) {
    // Validate event data
    if (!event || !event.email) {
      this.logger.error(`Invalid user.registered event received: ${JSON.stringify(event)}`);
      return;
    }

    this.logger.log(`Queueing verification email for ${event.email}`);
    await this.sendVerificationEmail(event.email, event.name, false);
  }

  @OnEvent('verification.email-requested', { async: true })
  async handleVerificationEmailRequested(event: VerificationEmailRequestedEvent) {
    // Validate event data
    if (!event || !event.email) {
      this.logger.error(
        `Invalid verification.email-requested event received: ${JSON.stringify(event)}`,
      );
      return;
    }

    this.logger.log(
      `Queueing ${event.isResend ? 'resend' : 'verification'} email for ${event.email}`,
    );
    await this.sendVerificationEmail(event.email, event.name, event.isResend);
  }

  @OnEvent('password.reset-requested', { async: true })
  async handlePasswordResetRequested(event: PasswordResetRequestedEvent) {
    this.logger.log(`Queueing password reset email for ${event.email}`);

    await this.pgBossService.sendToQueue('email-password-reset', {
      to: event.email,
      subject: 'DevsLoop Vault - Password Reset Request',
      html: `
        <h1>Password Reset Request</h1>
        <p>We received a request to reset your password.</p>
        <p>Click the link below to reset your password:</p>
        <a href="${event.resetUrl}">Reset Password</a>
        <p>This link will expire in 1 hour.</p>
        <p>If you didn't request a password reset, please ignore this email.</p>
      `,
    });
  }

  @OnEvent('password.changed', { async: true })
  async handlePasswordChanged(event: PasswordChangedEvent) {
    this.logger.log(`Queueing password change notification for ${event.email}`);

    await this.pgBossService.sendToQueue('email-notification', {
      to: event.email,
      subject: 'DevsLoop Vault - Password Changed',
      html: `
        <h1>Password Changed Successfully</h1>
        <p>Your password has been changed successfully.</p>
        <p>If you didn't make this change, please contact support immediately.</p>
      `,
    });
  }
}
