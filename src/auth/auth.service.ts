import {
  Injectable,
  UnauthorizedException,
  ConflictException,
  BadRequestException,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
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
import { PasswordResetService, TokenService, AuditLogService } from './services';
import {
  UserRegisteredEvent,
  VerificationEmailRequestedEvent,
  UserLoggedInEvent,
  UserLoggedOutEvent,
  PasswordResetRequestedEvent,
  PasswordResetCompletedEvent,
  PasswordChangedEvent,
} from './events';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly passwordResetService: PasswordResetService,
    private readonly tokenService: TokenService,
    private readonly auditLogService: AuditLogService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async register(registerDto: RegisterDto): Promise<AuthResponseDto> {
    const { email, password, name, department } = registerDto;

    // Check if user already exists
    const existingUser = await this.prisma.user.findUnique({
      where: { email },
    });

    if (existingUser) {
      throw new ConflictException('User with this email already exists');
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Create user with roleId set to null (admin will assign role after approval)
    const user = await this.prisma.user.create({
      data: {
        email,
        name,
        password: hashedPassword,
        department,
        roleId: null,
        emailVerified: false,
        hasAccess: 1,
      },
      include: {
        role: true,
      },
    });

    // Generate tokens
    const tokens = await this.tokenService.generateTokens(user.id, user.email);

    // Store refresh token
    await this.tokenService.storeRefreshToken(user.id, tokens.refreshToken);

    // Emit event for email and audit (async, non-blocking)
    this.eventEmitter.emit(
      'user.registered',
      new UserRegisteredEvent(user.id, user.email, user.name),
    );

    this.logger.log(`User registered: ${user.email}`);

    return {
      ...tokens,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        roleId: user.roleId,
        role: user.role
          ? { id: user.role.id, name: user.role.name, displayName: user.role.displayName }
          : null,
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
      include: {
        role: true,
      },
    });

    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    // Verify password
    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    // Check if user has access (hasAccess = 1 means has access, 0 means no access)
    if (user.hasAccess === 0) {
      throw new UnauthorizedException(
        'Access revoked: Your account access has been revoked by an administrator. Please contact support if you believe this is an error.',
      );
    }

    // Generate tokens
    const tokens = await this.tokenService.generateTokens(user.id, user.email);

    // Store refresh token (rotate token)
    await this.tokenService.storeRefreshToken(user.id, tokens.refreshToken);

    // Emit event for audit (async, non-blocking)
    this.eventEmitter.emit('user.logged-in', new UserLoggedInEvent(user.id, user.email));

    this.logger.log(`User logged in: ${user.email}`);

    return {
      ...tokens,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        roleId: user.roleId,
        role: user.role
          ? { id: user.role.id, name: user.role.name, displayName: user.role.displayName }
          : null,
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
      const payload = this.tokenService.verifyRefreshToken(refreshToken);

      // Find user
      const user = await this.prisma.user.findUnique({
        where: { id: payload.sub },
        include: {
          role: true,
        },
      });

      if (!user) {
        throw new UnauthorizedException('Invalid refresh token');
      }

      // Check if user has access (hasAccess = 1 means has access, 0 means no access)
      if (user.hasAccess === 0) {
        throw new UnauthorizedException(
          'Access revoked: Your account access has been revoked by an administrator. Please contact support if you believe this is an error.',
        );
      }

      // Verify stored refresh token matches
      const isTokenValid = await this.tokenService.verifyStoredToken(user.id, refreshToken);
      if (!isTokenValid) {
        throw new UnauthorizedException('Invalid refresh token');
      }

      // Generate new tokens (token rotation)
      const tokens = await this.tokenService.generateTokens(user.id, user.email);

      // Update refresh token
      await this.tokenService.storeRefreshToken(user.id, tokens.refreshToken);

      return {
        ...tokens,
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          roleId: user.roleId,
          role: user.role
            ? { id: user.role.id, name: user.role.name, displayName: user.role.displayName }
            : null,
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

    // Invalidate all refresh tokens
    await this.tokenService.invalidateRefreshTokens(userId);

    // Emit event for audit (async, non-blocking)
    if (user) {
      this.eventEmitter.emit('user.logged-out', new UserLoggedOutEvent(userId, user.email));
      this.logger.log(`User logged out: ${user.email}`);
    }

    return { message: 'Logged out successfully' };
  }

  async getCurrentUser(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        name: true,
        // roleId: true,
        role: {
          select: {
            // id: true,
            name: true,
            displayName: true,
            // description: true,
            roleEntities: {
              where: {
                entity: {
                  isActive: true,
                },
              },
              select: {
                entity: {
                  select: {
                    // id: true,
                    name: true,
                    displayName: true,
                    // description: true,
                  },
                },
              },
            },
          },
        },
        department: true,
        avatarUrl: true,
        emailVerified: true,
        hasAccess: true,
        createdAt: true,
        updatedAt: true,
        approvalStatus: true,
        reviewedAt: true,
        // rejectionReason: true,
        reviewedBy: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
        aclEntries: {
          where: {
            entity: {
              isActive: true,
            },
          },
          select: {
            entity: {
              select: {
                // id: true,
                name: true,
                displayName: true,
                // description: true,
              },
            },
            grantedAt: true,
          },
        },
      },
    });

    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    // Combine role-based and direct ACL entity permissions
    const entityPermissions = new Map<string, any>();

    // Add role-based permissions
    if (user.role?.roleEntities) {
      user.role.roleEntities.forEach((roleEntity) => {
        const entity = roleEntity.entity;
        entityPermissions.set(entity.name, {
          // id: entity.id,
          name: entity.name,
          displayName: entity.displayName,
          // description: entity.description,
          source: 'role',
          roleName: user.role?.name,
        });
      });
    }

    // Add direct ACL permissions (these override role-based if duplicate)
    if (user.aclEntries) {
      user.aclEntries.forEach((aclEntry) => {
        const entity = aclEntry.entity;
        entityPermissions.set(entity.name, {
          // id: entity.id,
          name: entity.name,
          displayName: entity.displayName,
          // description: entity.description,
          // source: 'direct',
          // grantedAt: aclEntry.grantedAt,
        });
      });
    }

    // Convert map to array
    const permissions = Array.from(entityPermissions.values());

    // Remove aclEntries and roleEntities from user object before returning
    const { aclEntries, role: roleWithEntities, ...userWithoutAcl } = user;

    // Clean role object (remove roleEntities)
    const cleanRole = roleWithEntities
      ? {
          // id: roleWithEntities.id,
          name: roleWithEntities.name,
          displayName: roleWithEntities.displayName,
          // description: roleWithEntities.description,
        }
      : null;

    return {
      ...userWithoutAcl,
      role: cleanRole,
      permissions,
    };
  }

  /**
   * Verify email using verification token from email link
   * Token-based verification only (no OTP support)
   */
  async verifyEmail(verifyEmailDto: VerifyEmailDto): Promise<{ message: string }> {
    const { email, token } = verifyEmailDto;

    if (!token) {
      throw new BadRequestException('Verification token is required');
    }

    // Find user
    const user = await this.prisma.user.findUnique({
      where: { email },
      select: {
        id: true,
        email: true,
        emailVerified: true,
        emailVerificationToken: true,
        emailVerificationExpires: true,
      },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    if (user.emailVerified) {
      throw new BadRequestException('Email is already verified');
    }

    if (!user.emailVerificationToken || !user.emailVerificationExpires) {
      throw new BadRequestException(
        'No verification token found. Please request a new verification email.',
      );
    }

    // Check if token has expired
    if (user.emailVerificationExpires < new Date()) {
      throw new BadRequestException(
        'Verification token has expired. Please request a new verification email.',
      );
    }

    // Verify token matches stored hash
    const isValid = await bcrypt.compare(token, user.emailVerificationToken);

    if (!isValid) {
      throw new BadRequestException('Invalid verification token');
    }

    // Update user emailVerified status and clear token
    await this.prisma.user.update({
      where: { email },
      data: {
        emailVerified: true,
        emailVerificationToken: null,
        emailVerificationExpires: null,
      },
    });

    this.logger.log(`Email verified successfully for user: ${email}`);

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

    // Emit event to resend verification email (handler will generate new token)
    this.eventEmitter.emit(
      'verification.email-requested',
      new VerificationEmailRequestedEvent(user.id, user.email, user.name, true),
    );

    this.logger.log(`Verification email resend requested for user: ${email}`);

    return { message: 'Verification email sent successfully' };
  }

  async validateUser(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        name: true,
        roleId: true,
        role: {
          select: {
            id: true,
            name: true,
            displayName: true,
          },
        },
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
      const resetToken = await this.passwordResetService.generateResetToken();
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

      // Emit event for email and audit (async, non-blocking)
      this.eventEmitter.emit(
        'password.reset-requested',
        new PasswordResetRequestedEvent(email, resetToken, resetUrl),
      );

      this.logger.log(`Password reset requested for: ${email}`);
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
    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        password: hashedPassword,
        passwordResetToken: null,
        passwordResetExpires: null,
      },
    });

    // Invalidate all refresh tokens (security best practice)
    await this.tokenService.invalidateRefreshTokens(user.id);

    // Emit event for audit (async, non-blocking)
    this.eventEmitter.emit(
      'password.reset-completed',
      new PasswordResetCompletedEvent(user.id, user.email),
    );

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

    // Update password
    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        password: hashedPassword,
      },
    });

    // Invalidate all refresh tokens
    await this.tokenService.invalidateRefreshTokens(userId);

    // Emit event for email notification and audit (async, non-blocking)
    this.eventEmitter.emit('password.changed', new PasswordChangedEvent(userId, user.email));

    this.logger.log(`Password changed for user ${userId}`);

    return {
      message: 'Password changed successfully. Please login again with your new password.',
    };
  }
}
