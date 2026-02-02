import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
// SendGrid disabled – no API key. Uncomment when SENDGRID_API_KEY is set.
// import * as sgMail from '@sendgrid/mail';

@Injectable()
export class EmailVerificationService {
  private readonly logger = new Logger(EmailVerificationService.name);
  // In-memory store for MVP (use Redis in production)
  private verificationCodes = new Map<string, { code: string; expiresAt: Date }>();
  private readonly fromEmail: string;
  private readonly fromName: string;

  constructor(private readonly configService: ConfigService) {
    // SendGrid disabled – no API key. Uncomment when SENDGRID_API_KEY is set.
    // const apiKey = this.configService.get<string>('SENDGRID_API_KEY');
    // if (apiKey) {
    //   sgMail.setApiKey(apiKey);
    // }
    this.fromEmail = this.configService.get<string>('FROM_EMAIL') || 'noreply@devsloop.com';
    this.fromName = this.configService.get<string>('FROM_NAME') || 'DevsLoop Vault';
  }

  async sendVerificationEmail(email: string): Promise<string> {
    // Generate 6-digit verification code
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    // Store code
    this.verificationCodes.set(email, { code, expiresAt });

    try {
      await Promise.resolve(); // SendGrid send commented out; keep async for when re-enabled
      // SendGrid disabled – no API key. Log code for dev/testing. Uncomment when SENDGRID_API_KEY is set.
      // await sgMail.send({
      //   to: email,
      //   from: { email: this.fromEmail, name: this.fromName },
      //   subject: 'Verify Your Email - DevsLoop Vault',
      //   text: `Your verification code is: ${code}. This code will expire in 10 minutes.`,
      //   html: this.getVerificationEmailTemplate(code),
      // });
      this.logger.log(
        `📧 [SendGrid disabled] Verification code for ${email}: ${code} (expires in 10 min)`,
      );
    } catch (error) {
      this.logger.error(`❌ Failed to send verification email to ${email}`, error);
    }

    return code; // Return code for testing (remove in production)
  }

  private getVerificationEmailTemplate(code: string): string {
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
              color: #007bff;
              margin: 0;
              font-size: 28px;
            }
            .code-container {
              background: #f8f9fa;
              border: 2px dashed #007bff;
              border-radius: 8px;
              padding: 30px;
              text-align: center;
              margin: 30px 0;
            }
            .code {
              font-size: 36px;
              font-weight: bold;
              color: #007bff;
              letter-spacing: 8px;
              font-family: 'Courier New', monospace;
            }
            .info {
              color: #666;
              font-size: 14px;
              text-align: center;
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
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>🔐 Email Verification</h1>
              <p>Welcome to DevsLoop Vault!</p>
            </div>
            
            <p>Thank you for registering. Please use the verification code below to verify your email address:</p>
            
            <div class="code-container">
              <div class="code">${code}</div>
            </div>
            
            <div class="info">
              <p><strong>⏰ This code will expire in 15 minutes</strong></p>
            </div>
            
            <div class="warning">
              <p><strong>⚠️ Security Notice:</strong></p>
              <p>If you didn't create an account with DevsLoop Vault, please ignore this email or contact support if you have concerns.</p>
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

  verifyCode(email: string, code: string): boolean {
    const stored = this.verificationCodes.get(email);

    if (!stored) {
      return false;
    }

    if (new Date() > stored.expiresAt) {
      this.verificationCodes.delete(email);
      return false;
    }

    if (stored.code !== code) {
      return false;
    }

    // Code is valid, remove it
    this.verificationCodes.delete(email);
    return true;
  }

  async resendVerificationCode(email: string): Promise<string> {
    return this.sendVerificationEmail(email);
  }
}
