import {
  Injectable,
  UnauthorizedException,
  ConflictException,
  BadRequestException,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { getFrontendUrl } from '../common/utils/frontend-url';
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
import { UpdateProfileDto } from './dto/update-profile.dto';
import { AuthResponseDto } from './dto/auth-response.dto';
import { PasswordResetService, TokenService, AuditLogService } from './services';
import { AclService } from '../rbac/rbac.service';
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
    const { email, password, name, departments } = registerDto;

    // Check if user already exists
    const existingUser = await this.prisma.user.findUnique({
      where: { email },
    });

    if (existingUser) {
      throw new ConflictException('User with this email already exists');
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Create user (admin will assign role via UserRoleAssignment after approval)
    const user = await this.prisma.user.create({
      data: {
        email,
        name,
        password: hashedPassword,
        departments: departments ?? [],
        emailVerified: false,
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
        roles: [], // New user has no roles yet
        departments: user.departments,
        avatarUrl: user.avatarUrl || undefined,
        emailVerified: user.emailVerified,
        mustChangePassword: false,
      },
    };
  }

  async login(loginDto: LoginDto): Promise<AuthResponseDto> {
    const { email, password } = loginDto;

    const user = await this.prisma.user.findUnique({
      where: { email },
      include: {
        userRoleAssignments: {
          where: { role: { isActive: true } },
          select: {
            isPrimary: true,
            role: { select: { id: true, name: true, displayName: true } },
          },
        },
      },
    });

    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    if (!user.password) {
      throw new UnauthorizedException('Invalid credentials');
    }

    // Verify password
    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    // Check if user has access
    if (user.employeeStatus !== 'ACTIVE') {
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
        roles: user.userRoleAssignments.map((a) => ({
          id: a.role.id,
          name: a.role.name,
          displayName: a.role.displayName,
          isPrimary: a.isPrimary,
        })),
        departments: user.departments,
        avatarUrl: user.avatarUrl || undefined,
        emailVerified: user.emailVerified,
        mustChangePassword: user.mustChangePassword,
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
          userRoleAssignments: {
            where: { role: { isActive: true } },
            select: {
              isPrimary: true,
              role: { select: { id: true, name: true, displayName: true } },
            },
          },
        },
      });

      if (!user) {
        throw new UnauthorizedException('Invalid refresh token');
      }

      // Check if user has access
      if (user.employeeStatus !== 'ACTIVE') {
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
          roles: user.userRoleAssignments.map((a) => ({
            id: a.role.id,
            name: a.role.name,
            displayName: a.role.displayName,
            isPrimary: a.isPrimary,
          })),
          departments: user.departments,
          avatarUrl: user.avatarUrl || undefined,
          emailVerified: user.emailVerified,
          mustChangePassword: user.mustChangePassword,
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
        isSystem: true,
        userRoleAssignments: {
          where: {
            role: {
              isActive: true,
            },
          },
          select: {
            isPrimary: true,
            role: {
              select: {
                name: true,
                displayName: true,
                roleEntities: {
                  where: {
                    entity: {
                      isActive: true,
                    },
                  },
                  select: {
                    actions: true,
                    entity: {
                      select: {
                        name: true,
                        displayName: true,
                      },
                    },
                  },
                },
              },
            },
          },
        },
        departments: true,
        avatarUrl: true,
        bio: true,
        emailVerified: true,
        mustChangePassword: true,
        baseSalaryMonthly: true,
        tier: true,
        createdAt: true,
        updatedAt: true,
        approvalStatus: true,
        reviewedAt: true,
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

    // Build permissions from role-based entity assignments; include merged actions for UI gating (aligned with AclService.getUserEntityActions).
    const entityPermissions = new Map<
      string,
      { name: string; displayName: string; actions: Set<string> }
    >();

    for (const assignment of user.userRoleAssignments) {
      if (assignment.role?.roleEntities) {
        assignment.role.roleEntities.forEach((roleEntity) => {
          const entity = roleEntity.entity;
          const existing = entityPermissions.get(entity.name);
          const bucket =
            existing ??
            ({
              name: entity.name,
              displayName: entity.displayName,
              actions: new Set<string>(),
            } satisfies { name: string; displayName: string; actions: Set<string> });

          // System users: the SYSTEM role was seeded with generic defaultActions
          // (e.g. 'read', 'write') that don't include entity-specific ones like
          // 'view'/'create'/'edit'. Rather than requiring a DB migration every
          // time a new entity with custom actions is added, system users always
          // receive the full action set defined in ENTITY_ACTIONS for that entity.
          if (user.isSystem) {
            const definedActions = AclService.ENTITY_ACTIONS[entity.name] ?? [];
            for (const { action } of definedActions) {
              bucket.actions.add(action);
            }
            // Also keep the generic role actions so system users don't lose them
            for (const action of roleEntity.actions) {
              bucket.actions.add(action);
            }
          } else {
            for (const action of roleEntity.actions) {
              bucket.actions.add(action);
            }
          }

          entityPermissions.set(entity.name, bucket);
        });
      }
    }

    // For system users: the loop above only covers entities that already have a
    // roleEntities row in the DB (i.e. entities that existed when SYSTEM role was
    // last seeded). Any entity added to ENTITY_ACTIONS afterwards won't appear
    // — and we can't re-run seed on a live DB. So we patch the gap here:
    // find every ENTITY_ACTIONS key not yet in the map and add it with a single
    // targeted DB lookup for the display name.
    if (user.isSystem) {
      const missingNames = Object.keys(AclService.ENTITY_ACTIONS).filter(
        (name) => !entityPermissions.has(name),
      );

      if (missingNames.length > 0) {
        const missingEntities = await this.prisma.entity.findMany({
          where: { name: { in: missingNames }, isActive: true },
          select: { name: true, displayName: true },
        });

        for (const entity of missingEntities) {
          entityPermissions.set(entity.name, {
            name: entity.name,
            displayName: entity.displayName,
            actions: new Set(
              (AclService.ENTITY_ACTIONS[entity.name] ?? []).map(({ action }) => action),
            ),
          });
        }
      }
    }

    const permissions = Array.from(entityPermissions.values()).map((entry) => ({
      name: entry.name,
      displayName: entry.displayName,
      actions: [...entry.actions],
    }));

    // Build clean roles array
    const roles = user.userRoleAssignments.map((a) => ({
      name: a.role.name,
      displayName: a.role.displayName,
      isPrimary: a.isPrimary,
    }));

    // Find primary role for backward compatibility
    const primaryAssignment = user.userRoleAssignments.find((a) => a.isPrimary);
    const role = primaryAssignment
      ? {
          name: primaryAssignment.role.name,
          displayName: primaryAssignment.role.displayName,
        }
      : null;

    // Remove internal fields from user object before returning
    const { userRoleAssignments: _assignments, baseSalaryMonthly, ...userWithoutInternals } = user;

    return {
      ...userWithoutInternals,
      baseSalaryMonthly: baseSalaryMonthly != null ? baseSalaryMonthly.toString() : null,
      role,
      roles,
      permissions,
    };
  }

  async updateProfile(userId: string, dto: UpdateProfileDto) {
    const data: {
      name?: string;
      departments?: string[];
      avatarUrl?: string | null;
      bio?: string | null;
    } = {};
    if (dto.name !== undefined) {
      const trimmed = dto.name.trim();
      if (trimmed) data.name = trimmed;
    }
    if (dto.departments !== undefined) data.departments = dto.departments;
    if (dto.avatarUrl !== undefined)
      data.avatarUrl = dto.avatarUrl === '' ? null : (dto.avatarUrl ?? null);
    if (dto.bio !== undefined) data.bio = dto.bio === '' ? null : (dto.bio ?? null);
    if (Object.keys(data).length === 0) {
      return this.getCurrentUser(userId);
    }
    await this.prisma.user.update({
      where: { id: userId },
      data,
    });
    return this.getCurrentUser(userId);
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
        userRoleAssignments: {
          where: { role: { isActive: true } },
          select: {
            isPrimary: true,
            role: { select: { id: true, name: true, displayName: true } },
          },
        },
        departments: true,
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
      // Generate secure reset token and hash it with SHA-256 for direct DB lookup
      const resetToken = this.passwordResetService.generateResetToken();
      const hashedToken = this.passwordResetService.hashResetToken(resetToken);
      const expiresAt = this.passwordResetService.getTokenExpiration();

      // Store hashed token and expiration
      await this.prisma.user.update({
        where: { id: user.id },
        data: {
          passwordResetToken: hashedToken,
          passwordResetExpires: expiresAt,
        },
      });

      const resetUrl = `${getFrontendUrl()}/reset-password?token=${resetToken}`;

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

    // Hash the incoming token and query directly — O(1) vs O(n) table scan
    const hashedToken = this.passwordResetService.hashResetToken(token);

    const user = await this.prisma.user.findFirst({
      where: {
        passwordResetToken: hashedToken,
        passwordResetExpires: { gte: new Date() },
      },
    });

    if (!user) {
      throw new BadRequestException('Invalid or expired reset token');
    }

    // Hash new password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Update password, clear reset token, and clear mustChangePassword flag
    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        password: hashedPassword,
        passwordResetToken: null,
        passwordResetExpires: null,
        mustChangePassword: false,
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
   * Change Password - Change password for authenticated user.
   * When user had mustChangePassword (e.g. temp password), we do not invalidate tokens so they stay logged in.
   */
  async changePassword(
    userId: string,
    changePasswordDto: ChangePasswordDto,
  ): Promise<{ message: string; requireRelogin?: boolean }> {
    const { currentPassword, newPassword } = changePasswordDto;

    // Get user with password and mustChangePassword
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, password: true, mustChangePassword: true },
    });

    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    if (!user.password) {
      throw new UnauthorizedException('No password set for this account');
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
    const wasMustChangePassword = user.mustChangePassword === true;

    // Update password and clear mustChangePassword
    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        password: hashedPassword,
        mustChangePassword: false,
      },
    });

    // Only invalidate tokens when user was not forced to change (e.g. changing from settings)
    if (!wasMustChangePassword) {
      await this.tokenService.invalidateRefreshTokens(userId);
    }

    // Emit event for email notification and audit (async, non-blocking)
    this.eventEmitter.emit('password.changed', new PasswordChangedEvent(userId, user.email));

    this.logger.log(`Password changed for user ${userId}`);

    return {
      message: wasMustChangePassword
        ? 'Password changed successfully. You can continue to the dashboard.'
        : 'Password changed successfully. Please login again with your new password.',
      requireRelogin: !wasMustChangePassword,
    };
  }

  async loginWithGoogle(googleProfile: { email: string; name: string; avatarUrl?: string }) {
    if (!googleProfile.email?.endsWith('@devslooptech.com')) {
      return { error: 'wrong_domain' };
    }

    const user = await this.prisma.user.findUnique({
      where: { email: googleProfile.email },
      include: {
        userRoleAssignments: {
          where: { role: { isActive: true } },
          select: {
            isPrimary: true,
            role: { select: { id: true, name: true, displayName: true } },
          },
        },
      },
    });

    if (!user) return { error: 'no_account' };
    if (user.employeeStatus !== 'ACTIVE') return { error: 'access_revoked' };
    if (user.approvalStatus !== 'APPROVED') return { error: 'not_approved' };

    // Consolidate both conditional updates into a single DB write
    const updateData: { mustChangePassword?: boolean; avatarUrl?: string } = {};
    if (user.mustChangePassword) updateData.mustChangePassword = false;
    if (!user.avatarUrl && googleProfile.avatarUrl) updateData.avatarUrl = googleProfile.avatarUrl;
    if (Object.keys(updateData).length > 0) {
      await this.prisma.user.update({ where: { id: user.id }, data: updateData });
    }

    const tokens = await this.tokenService.generateTokens(user.id, user.email);
    await this.tokenService.storeRefreshToken(user.id, tokens.refreshToken);

    this.eventEmitter.emit('user.logged-in', new UserLoggedInEvent(user.id, user.email));
    this.logger.log(`User logged in via Google: ${user.email}`);

    return { tokens, user };
  }
}
