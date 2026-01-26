import {
  Injectable,
  UnauthorizedException,
  ConflictException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { JwtService, JwtSignOptions } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import type { StringValue } from 'ms';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { VerifyEmailDto } from './dto/verify-email.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { AuthResponseDto } from './dto/auth-response.dto';
import { EmailVerificationService } from './services/email-verification.service';
import { PasswordResetService } from './services/password-reset.service';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
    private configService: ConfigService,
    private emailVerificationService: EmailVerificationService,
    private passwordResetService: PasswordResetService,
  ) {}

  async register(registerDto: RegisterDto): Promise<AuthResponseDto> {
    const { email, password, name, department, role } = registerDto;

    // Check if user already exists
    const existingUser = await this.prisma.user.findUnique({
      where: { email },
    });

    if (existingUser) {
      throw new ConflictException('User with this email already exists');
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Create user
    const user = await this.prisma.user.create({
      data: {
        email,
        name,
        password: hashedPassword,
        department,
        role: role || 'EMPLOYEE',
        emailVerified: false,
      },
    });

    // Send verification email
    await this.emailVerificationService.sendVerificationEmail(email);

    // Generate tokens
    const tokens = await this.generateTokens(user.id, user.email);

    // Store refresh token
    await this.updateRefreshToken(user.id, tokens.refreshToken);

    // Audit log
    await this.createAuditLog(user.id, 'REGISTER', 'User', user.id, {
      email: user.email,
      timestamp: new Date().toISOString(),
    });

    return {
      ...tokens,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        department: user.department || undefined,
        avatarUrl: user.avatarUrl || undefined,
        emailVerified: user.emailVerified,
      },
    };
  }

  async login(loginDto: LoginDto): Promise<AuthResponseDto> {
    const { email, password } = loginDto;

    const user = await this.prisma.user.findUnique({
      where: { email },
    });

    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    // Verify password
    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    // Generate tokens
    const tokens = await this.generateTokens(user.id, user.email);

    // Store refresh token (rotate token)
    await this.updateRefreshToken(user.id, tokens.refreshToken);

    // Audit log
    await this.createAuditLog(user.id, 'LOGIN', 'User', user.id, {
      email: user.email,
      timestamp: new Date().toISOString(),
    });

    return {
      ...tokens,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        department: user.department || undefined,
        avatarUrl: user.avatarUrl || undefined,
        emailVerified: user.emailVerified,
      },
    };
  }

  async refresh(refreshTokenDto: RefreshTokenDto): Promise<AuthResponseDto> {
    const { refreshToken } = refreshTokenDto;

    try {
      // Verify refresh token
      const payload = this.jwtService.verify(refreshToken, {
        secret: this.configService.get<string>('JWT_REFRESH_SECRET') || 'refresh-secret-key',
      });

      // Find user
      const user = await this.prisma.user.findUnique({
        where: { id: payload.sub },
      });

      if (!user || !user.refreshToken) {
        throw new UnauthorizedException('Invalid refresh token');
      }

      // Verify stored refresh token matches (compare hashed)
      const isTokenValid = await bcrypt.compare(refreshToken, user.refreshToken);
      if (!isTokenValid) {
        throw new UnauthorizedException('Invalid refresh token');
      }

      // Generate new tokens (token rotation)
      const tokens = await this.generateTokens(user.id, user.email);

      // Update refresh token
      await this.updateRefreshToken(user.id, tokens.refreshToken);

      return {
        ...tokens,
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          department: user.department || undefined,
          avatarUrl: user.avatarUrl || undefined,
          emailVerified: user.emailVerified,
        },
      };
    } catch (error) {
      if (error instanceof UnauthorizedException) {
        throw error;
      }
      throw new UnauthorizedException('Invalid or expired refresh token');
    }
  }

  async logout(userId: string): Promise<{ message: string }> {
    // Get user for audit log
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { email: true },
    });

    // Remove refresh token (logout from all devices)
    // This invalidates all refresh tokens for the user
    await this.prisma.user.update({
      where: { id: userId },
      data: { refreshToken: null },
    });

    // Audit log
    if (user) {
      await this.createAuditLog(userId, 'LOGOUT', 'User', userId, {
        email: user.email,
        timestamp: new Date().toISOString(),
      });
    }

    this.logger.log(`User ${userId} logged out`);
    return { message: 'Logged out successfully' };
  }

  async getCurrentUser(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        department: true,
        avatarUrl: true,
        emailVerified: true,
        createdAt: true,
        updatedAt: true,
        approvalStatus: true,
        reviewedAt: true,
        rejectionReason: true,
        reviewedBy: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
    });

    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    return user;
  }

  async verifyEmail(verifyEmailDto: VerifyEmailDto): Promise<{ message: string }> {
    const { email, code } = verifyEmailDto;

    const isValid = this.emailVerificationService.verifyCode(email, code);

    if (!isValid) {
      throw new BadRequestException('Invalid or expired verification code');
    }

    // Update user emailVerified status
    await this.prisma.user.update({
      where: { email },
      data: { emailVerified: true },
    });

    return { message: 'Email verified successfully' };
  }

  async resendVerificationCode(email: string): Promise<{ message: string }> {
    const user = await this.prisma.user.findUnique({
      where: { email },
    });

    if (!user) {
      throw new BadRequestException('User not found');
    }

    if (user.emailVerified) {
      throw new BadRequestException('Email already verified');
    }

    await this.emailVerificationService.resendVerificationCode(email);

    return { message: 'Verification code sent successfully' };
  }

  private async generateTokens(userId: string, email: string) {
    const payload = { sub: userId, email };

    const accessTokenExpiresIn = (this.configService.get<string>('JWT_EXPIRES_IN') ||
      '15m') as StringValue;
    const refreshTokenExpiresIn = (this.configService.get<string>('JWT_REFRESH_EXPIRES_IN') ||
      '7d') as StringValue;

    const accessTokenOptions: JwtSignOptions = {
      secret: this.configService.get<string>('JWT_SECRET') || 'your-secret-key',
      expiresIn: accessTokenExpiresIn,
    };

    const refreshTokenOptions: JwtSignOptions = {
      secret: this.configService.get<string>('JWT_REFRESH_SECRET') || 'refresh-secret-key',
      expiresIn: refreshTokenExpiresIn,
    };

    const [accessToken, refreshToken] = await Promise.all([
      this.jwtService.signAsync(payload, accessTokenOptions),
      this.jwtService.signAsync(payload, refreshTokenOptions),
    ]);

    return { accessToken, refreshToken };
  }

  private async updateRefreshToken(userId: string, refreshToken: string) {
    // Hash refresh token before storing (optional but recommended)
    const hashedToken = await bcrypt.hash(refreshToken, 10);
    await this.prisma.user.update({
      where: { id: userId },
      data: { refreshToken: hashedToken },
    });
  }

  async validateUser(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        department: true,
        avatarUrl: true,
        emailVerified: true,
      },
    });

    return user;
  }

  /**
   * Forgot Password - Generate and send password reset token
   * Security: Does not reveal if email exists (prevents user enumeration)
   */
  async forgotPassword(forgotPasswordDto: ForgotPasswordDto): Promise<{ message: string }> {
    const { email } = forgotPasswordDto;

    // Find user (but don't reveal if email exists)
    const user = await this.prisma.user.findUnique({
      where: { email },
    });

    // Always return success message to prevent user enumeration
    // Only proceed if user exists
    if (user) {
      // Generate secure reset token
      const resetToken = this.passwordResetService.generateResetToken();
      const hashedToken = await this.passwordResetService.hashResetToken(resetToken);
      const expiresAt = this.passwordResetService.getTokenExpiration();

      // Store hashed token and expiration
      await this.prisma.user.update({
        where: { id: user.id },
        data: {
          passwordResetToken: hashedToken,
          passwordResetExpires: expiresAt,
        },
      });

      // Build reset URL
      const resetUrl = `${this.configService.get<string>('FRONTEND_URL') || 'http://localhost:3000'}/reset-password?token=${resetToken}`;

      // Send reset email
      await this.passwordResetService.sendPasswordResetEmail(email, resetToken, resetUrl);

      // Audit log
      await this.createAuditLog(user.id, 'FORGOT_PASSWORD_REQUEST', 'User', user.id, {
        email,
        timestamp: new Date().toISOString(),
      });
    }

    // Always return same message regardless of whether user exists
    return {
      message: 'If an account with that email exists, a password reset link has been sent.',
    };
  }

  /**
   * Reset Password - Validate token and update password
   * Security: Invalidates all refresh tokens on password reset
   */
  async resetPassword(resetPasswordDto: ResetPasswordDto): Promise<{ message: string }> {
    const { token, password } = resetPasswordDto;

    // Find users with valid (non-expired) reset tokens
    const users = await this.prisma.user.findMany({
      where: {
        passwordResetToken: { not: null },
        passwordResetExpires: { gte: new Date() },
      },
    });

    // Find user with matching token (verify hash)
    let user: (typeof users)[0] | null = null;
    for (const u of users) {
      if (u.passwordResetToken && u.passwordResetExpires) {
        // Verify token matches stored hash
        const isValid = await this.passwordResetService.verifyResetToken(
          token,
          u.passwordResetToken,
        );
        if (isValid) {
          user = u;
          break;
        }
      }
    }

    if (!user) {
      throw new BadRequestException('Invalid or expired reset token');
    }

    // Hash new password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Update password and clear reset token
    // Also invalidate all refresh tokens (security best practice)
    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        password: hashedPassword,
        passwordResetToken: null,
        passwordResetExpires: null,
        refreshToken: null, // Invalidate all refresh tokens
      },
    });

    // Audit log
    await this.createAuditLog(user.id, 'PASSWORD_RESET', 'User', user.id, {
      email: user.email,
      timestamp: new Date().toISOString(),
    });

    this.logger.log(`Password reset successful for user ${user.id}`);

    return {
      message: 'Password has been reset successfully. Please login with your new password.',
    };
  }

  /**
   * Change Password - Change password for authenticated user
   */
  async changePassword(
    userId: string,
    changePasswordDto: ChangePasswordDto,
  ): Promise<{ message: string }> {
    const { currentPassword, newPassword } = changePasswordDto;

    // Get user with password
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    // Verify current password
    const isPasswordValid = await bcrypt.compare(currentPassword, user.password);
    if (!isPasswordValid) {
      throw new UnauthorizedException('Current password is incorrect');
    }

    // Check if new password is different
    const isSamePassword = await bcrypt.compare(newPassword, user.password);
    if (isSamePassword) {
      throw new BadRequestException('New password must be different from current password');
    }

    // Hash new password
    const hashedPassword = await bcrypt.hash(newPassword, 10);

    // Update password and invalidate refresh tokens
    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        password: hashedPassword,
        refreshToken: null, // Invalidate all refresh tokens
      },
    });

    // Audit log
    await this.createAuditLog(userId, 'PASSWORD_CHANGED', 'User', userId, {
      email: user.email,
      timestamp: new Date().toISOString(),
    });

    this.logger.log(`Password changed for user ${userId}`);

    return {
      message: 'Password changed successfully. Please login again with your new password.',
    };
  }

  /**
   * Create audit log entry
   */
  private async createAuditLog(
    userId: string | null,
    action: string,
    entityType: string,
    entityId: string,
    changes: any,
  ): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          userId,
          action,
          entityType,
          entityId,
          changes,
          timestamp: new Date(),
        },
      });
    } catch (error) {
      // Log error but don't fail the operation
      this.logger.error(`Failed to create audit log: ${error}`);
    }
  }
}
