import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import {
  UserApprovedEvent,
  UserRejectedEvent,
  UserRolesChangedEvent,
  UserStatusChangedEvent,
} from '../events';
import { PgBossService } from '../../queue/pg-boss.service';

const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:3000';

@Injectable()
export class UserEmailHandler {
  private readonly logger = new Logger(UserEmailHandler.name);

  constructor(private readonly pgBossService: PgBossService) {}

  /**
   * Handle user approved event.
   * - First-time approval: send welcome email with assigned roles
   * - Re-approval with role changes: send role-updated email
   * - Re-approval without role changes: send simple re-approval confirmation
   */
  @OnEvent('user.approved', { async: true })
  async handleUserApproved(event: UserApprovedEvent) {
    this.logger.log(
      `Queueing approval email for ${event.email} (firstApproval=${event.isFirstApproval}, rolesChanged=${event.rolesChanged})`,
    );

    const roleList = event.roleNames.length > 0 ? event.roleNames.join(', ') : 'No roles assigned';

    if (event.isFirstApproval) {
      // First-time approval — send welcome email
      await this.pgBossService.sendToQueue(
        'email-welcome',
        {
          to: event.email,
          subject: 'DevsLoop Vault - Account Approved!',
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
              <h1 style="color: #2563eb;">Welcome to DevsLoop Vault, ${event.name}!</h1>
              <p>Great news! Your account has been <strong>approved</strong>.</p>
              <p>You have been assigned the following role(s):</p>
              <ul>
                ${event.roleNames.map((r) => `<li><strong>${r}</strong></li>`).join('')}
              </ul>
              <p>You now have full access to the DevsLoop Vault platform based on your assigned roles.</p>
              <p>Start contributing to projects and sharing your knowledge!</p>
              <div style="margin-top: 20px;">
                <a href="${FRONTEND_URL}/dashboard"
                   style="background-color: #2563eb; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block;">
                  Go to Dashboard
                </a>
              </div>
              <p style="margin-top: 30px; color: #6b7280; font-size: 12px;">
                If you have any questions, please contact your administrator.
              </p>
            </div>
          `,
        },
        {
          retryLimit: 3,
          retryDelay: 2000,
          retryBackoff: true,
        },
      );
    } else if (event.rolesChanged) {
      // Re-approval with role changes — send role-updated email
      await this.pgBossService.sendToQueue(
        'email-notification',
        {
          to: event.email,
          subject: 'DevsLoop Vault - Your Roles Have Been Updated',
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
              <h1 style="color: #2563eb;">Role Update</h1>
              <p>Dear ${event.name},</p>
              <p>Your roles on DevsLoop Vault have been updated by <strong>${event.approvedByName}</strong>.</p>
              <p>Your current role(s):</p>
              <ul>
                ${event.roleNames.map((r) => `<li><strong>${r}</strong></li>`).join('')}
              </ul>
              <p>Your permissions may have changed. Please review your access on the platform.</p>
              <div style="margin-top: 20px;">
                <a href="${FRONTEND_URL}/dashboard"
                   style="background-color: #2563eb; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block;">
                  Go to Dashboard
                </a>
              </div>
              <p style="margin-top: 30px; color: #6b7280; font-size: 12px;">
                If you believe this was done in error, please contact your administrator.
              </p>
            </div>
          `,
        },
        {
          retryLimit: 3,
          retryDelay: 2000,
          retryBackoff: true,
        },
      );
    }
    // If re-approved without role changes, no email is sent (no-op)
  }

  /**
   * Handle user rejected event — send rejection notification.
   */
  @OnEvent('user.rejected', { async: true })
  async handleUserRejected(event: UserRejectedEvent) {
    this.logger.log(`Queueing rejection email for ${event.email}`);

    await this.pgBossService.sendToQueue(
      'email-notification',
      {
        to: event.email,
        subject: 'DevsLoop Vault - Account Status Update',
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h1 style="color: #dc2626;">Account Review Update</h1>
            <p>Dear ${event.name},</p>
            <p>Thank you for your interest in DevsLoop Vault.</p>
            <p>After careful review, we are unable to approve your account at this time.</p>
            ${event.reason && event.reason !== 'No reason provided' ? `<p><strong>Reason:</strong> ${event.reason}</p>` : ''}
            <p>If you have any questions, please contact our support team.</p>
            <p style="margin-top: 30px; color: #6b7280; font-size: 12px;">
              This is an automated notification from DevsLoop Vault.
            </p>
          </div>
        `,
      },
      {
        retryLimit: 3,
        retryDelay: 2000,
        retryBackoff: true,
      },
    );
  }

  /**
   * Handle role changes from RBAC service (assign/remove/bulk update).
   * Sends appropriate email based on whether roles were added, removed, or both.
   */
  @OnEvent('user.roles-changed', { async: true })
  async handleUserRolesChanged(event: UserRolesChangedEvent) {
    this.logger.log(
      `Queueing role-change email for ${event.email} (added=${event.addedRoleNames.length}, removed=${event.removedRoleNames.length})`,
    );

    const hasAdded = event.addedRoleNames.length > 0;
    const hasRemoved = event.removedRoleNames.length > 0;

    let subject: string;
    let bodyContent: string;

    if (hasAdded && hasRemoved) {
      // Roles were both added and removed (reassignment)
      subject = 'DevsLoop Vault - Your Roles Have Been Updated';
      bodyContent = `
        <p>Your roles on DevsLoop Vault have been updated by <strong>${event.changedByName}</strong>.</p>
        <p><strong>New role(s) assigned:</strong></p>
        <ul>
          ${event.addedRoleNames.map((r) => `<li style="color: #16a34a;"><strong>${r}</strong></li>`).join('')}
        </ul>
        <p><strong>Role(s) removed:</strong></p>
        <ul>
          ${event.removedRoleNames.map((r) => `<li style="color: #dc2626;"><strong>${r}</strong></li>`).join('')}
        </ul>
      `;
    } else if (hasAdded) {
      // Only roles added
      subject = 'DevsLoop Vault - New Role Assigned';
      bodyContent = `
        <p>You have been assigned a new role on DevsLoop Vault by <strong>${event.changedByName}</strong>:</p>
        <ul>
          ${event.addedRoleNames.map((r) => `<li><strong>${r}</strong></li>`).join('')}
        </ul>
      `;
    } else if (hasRemoved) {
      // Only roles removed
      subject = 'DevsLoop Vault - Role Removed';
      bodyContent = `
        <p>The following role(s) have been removed from your account on DevsLoop Vault by <strong>${event.changedByName}</strong>:</p>
        <ul>
          ${event.removedRoleNames.map((r) => `<li><strong>${r}</strong></li>`).join('')}
        </ul>
      `;
    } else {
      // No actual changes — skip email
      return;
    }

    // Add current roles summary
    const currentRolesHtml =
      event.currentRoleNames.length > 0
        ? `
          <p style="margin-top: 16px;"><strong>Your current role(s):</strong></p>
          <ul>
            ${event.currentRoleNames.map((r) => `<li>${r}</li>`).join('')}
          </ul>
        `
        : `<p style="margin-top: 16px; color: #dc2626;">You currently have no roles assigned.</p>`;

    await this.pgBossService.sendToQueue(
      'email-notification',
      {
        to: event.email,
        subject,
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h1 style="color: #2563eb;">Role Update</h1>
            <p>Dear ${event.name},</p>
            ${bodyContent}
            ${currentRolesHtml}
            <p>Your permissions may have changed accordingly. Please review your access on the platform.</p>
            <div style="margin-top: 20px;">
              <a href="${FRONTEND_URL}/dashboard"
                 style="background-color: #2563eb; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block;">
                Go to Dashboard
              </a>
            </div>
            <p style="margin-top: 30px; color: #6b7280; font-size: 12px;">
              If you believe this was done in error, please contact your administrator.
            </p>
          </div>
        `,
      },
      {
        retryLimit: 3,
        retryDelay: 2000,
        retryBackoff: true,
      },
    );
  }

  /**
   * Handle user status change (access granted/revoked).
   */
  @OnEvent('user.status-changed', { async: true })
  async handleUserStatusChanged(event: UserStatusChangedEvent) {
    this.logger.log(
      `Queueing status-change email for ${event.email} (${event.previousStatus} -> ${event.newStatus})`,
    );

    const isActivated = event.newStatus === 1;
    const subject = isActivated
      ? 'DevsLoop Vault - Your Access Has Been Restored'
      : 'DevsLoop Vault - Your Access Has Been Revoked';

    const html = isActivated
      ? `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h1 style="color: #16a34a;">Access Restored</h1>
          <p>Dear ${event.name},</p>
          <p>Your access to DevsLoop Vault has been <strong>restored</strong> by an administrator.</p>
          <p>You can now log in and use the platform as before.</p>
          <div style="margin-top: 20px;">
            <a href="${FRONTEND_URL}/dashboard"
               style="background-color: #16a34a; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block;">
              Go to Dashboard
            </a>
          </div>
          <p style="margin-top: 30px; color: #6b7280; font-size: 12px;">
            If you have any questions, please contact your administrator.
          </p>
        </div>
      `
      : `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h1 style="color: #dc2626;">Access Revoked</h1>
          <p>Dear ${event.name},</p>
          <p>Your access to DevsLoop Vault has been <strong>revoked</strong> by an administrator.</p>
          <p>You will no longer be able to access the platform until your access is restored.</p>
          <p>If you believe this was done in error, please contact your administrator.</p>
          <p style="margin-top: 30px; color: #6b7280; font-size: 12px;">
            This is an automated notification from DevsLoop Vault.
          </p>
        </div>
      `;

    await this.pgBossService.sendToQueue(
      'email-notification',
      {
        to: event.email,
        subject,
        html,
      },
      {
        retryLimit: 3,
        retryDelay: 2000,
        retryBackoff: true,
      },
    );
  }
}
