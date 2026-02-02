import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcryptjs';
// SendGrid disabled – no API key. Uncomment when SENDGRID_API_KEY is set.
// import * as sgMail from '@sendgrid/mail';

@Injectable()
export class PasswordResetService {
  private readonly logger = new Logger(PasswordResetService.name);
  private readonly fromEmail: string;
  private readonly fromName: string;

  constructor(private configService: ConfigService) {
    // SendGrid disabled – no API key. Uncomment when SENDGRID_API_KEY is set.
    // const apiKey = this.configService.get<string>('SENDGRID_API_KEY');
    // if (apiKey) {
    //   sgMail.setApiKey(apiKey);
    // }
    this.fromEmail = this.configService.get<string>('FROM_EMAIL') || 'noreply@devsloop.com';
    this.fromName = this.configService.get<string>('FROM_NAME') || 'DevsLoop Vault';
  }

  /**
   * Generate a secure random reset token using bcryptjs
   */
  async generateResetToken(): Promise<string> {
    // Generate multiple salts and combine them for a longer token
    const salt1 = await bcrypt.genSalt(10);
    const salt2 = await bcrypt.genSalt(10);
    const salt3 = await bcrypt.genSalt(10);
    return (salt1 + salt2 + salt3).replace(/[^a-zA-Z0-9]/g, '').substring(0, 64);
  }

  /**
   * Hash reset token before storing in database
   */
  async hashResetToken(token: string): Promise<string> {
    return bcrypt.hash(token, 10);
  }

  /**
   * Verify reset token matches stored hash
   */
  async verifyResetToken(token: string, hashedToken: string): Promise<boolean> {
    return bcrypt.compare(token, hashedToken);
  }

  /**
   * Get token expiration time (default: 1 hour)
   */
  getTokenExpiration(): Date {
    const expirationHours =
      parseInt(this.configService.get<string>('PASSWORD_RESET_EXPIRES_HOURS') || '1', 10) || 1;
    const expirationDate = new Date();
    expirationDate.setHours(expirationDate.getHours() + expirationHours);
    return expirationDate;
  }

  /**
   * Check if token has expired
   */
  isTokenExpired(expiresAt: Date | null): boolean {
    if (!expiresAt) {
      return true;
    }
    return new Date() > expiresAt;
  }

  /**
   * Send password reset email. SendGrid disabled – no API key; logs reset URL for dev.
   */
  sendPasswordResetEmail(email: string, resetToken: string, resetUrl: string): Promise<void> {
    try {
      // SendGrid disabled – no API key. Uncomment when SENDGRID_API_KEY is set.
      // await sgMail.send({
      //   to: email,
      //   from: { email: this.fromEmail, name: this.fromName },
      //   subject: 'Reset Your Password - DevsLoop Vault',
      //   text: `You requested a password reset. Click this link to reset your password: ${resetUrl}\n\nIf you didn't request this, please ignore this email.`,
      //   html: this.getPasswordResetEmailTemplate(resetUrl),
      // });
      this.logger.log(`📧 [SendGrid disabled] Password reset link for ${email}: ${resetUrl}`);
    } catch (error) {
      this.logger.error(`❌ Failed to send password reset email to ${email}`, error);
    }
    return Promise.resolve();
  }

  private getPasswordResetEmailTemplate(resetUrl: string): string {
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
              color: #dc3545;
              margin: 0;
              font-size: 28px;
            }
            .button {
              display: inline-block;
              background: #007bff;
              color: white;
              padding: 14px 30px;
              text-decoration: none;
              border-radius: 6px;
              margin: 25px 0;
              font-weight: bold;
              text-align: center;
            }
            .button:hover {
              background: #0056b3;
            }
            .button-container {
              text-align: center;
            }
            .info {
              color: #666;
              font-size: 14px;
              margin-top: 20px;
            }
            .warning {
              background: #fff3cd;
              border-left: 4px solid #ffc107;
              padding: 15px;
              margin: 20px 0;
              border-radius: 4px;
            }
            .footer {
              text-align: center;
              margin-top: 30px;
              padding-top: 20px;
              border-top: 1px solid #e0e0e0;
              color: #999;
              font-size: 12px;
            }
            .link {
              word-break: break-all;
              color: #007bff;
              font-size: 12px;
            }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>🔒 Password Reset Request</h1>
            </div>
            
            <p>Hello,</p>
            <p>We received a request to reset your password for your DevsLoop Vault account.</p>
            
            <div class="button-container">
              <a href="${resetUrl}" class="button">Reset Your Password</a>
            </div>
            
            <div class="info">
              <p><strong>⏰ This link will expire in 1 hour</strong></p>
              <p>If the button doesn't work, copy and paste this link into your browser:</p>
              <p class="link">${resetUrl}</p>
            </div>
            
            <div class="warning">
              <p><strong>⚠️ Security Notice:</strong></p>
              <p>If you didn't request a password reset, please ignore this email. Your password will remain unchanged.</p>
              <p>If you're concerned about your account security, please contact support immediately.</p>
            </div>
            
            <div class="footer">
              <p>This is an automated message from DevsLoop Vault.</p>
              <p>Please do not reply to this email.</p>
            </div>
          </div>
        </body>
      </html>
    `;
  }
}
