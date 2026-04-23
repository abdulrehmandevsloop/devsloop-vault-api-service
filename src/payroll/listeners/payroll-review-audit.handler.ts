import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { PgBossService } from '../../queue/pg-boss.service';
import { RequestContextService } from '../../common/services/request-context.service';
import {
  PayrollSubmittedForReviewEvent,
  PayrollAuthorizedEvent,
  PayrollAuthorizationRevokedEvent,
  PayrollReviewRejectedEvent,
  PayrollTempAuthorizerDesignatedEvent,
} from '../events/payroll-review.events';

@Injectable()
export class PayrollReviewAuditHandler {
  private readonly logger = new Logger(PayrollReviewAuditHandler.name);

  constructor(
    private readonly pgBossService: PgBossService,
    private readonly requestContext: RequestContextService,
  ) {}

  @OnEvent('payroll.submitted-for-review', { async: true })
  async onSubmittedForReview(event: PayrollSubmittedForReviewEvent): Promise<void> {
    this.logger.log(`Queueing audit: payroll submitted for review ${event.periodId}`);
    await this.pgBossService.sendToQueue('audit-log', {
      userId: event.submitterId,
      action: 'PAYROLL_SUBMITTED_FOR_REVIEW',
      entityType: 'PayrollPeriod',
      entityId: event.periodId,
      ipAddress: this.requestContext.getIpAddress(),
      userAgent: this.requestContext.getUserAgent(),
      changes: {
        yearMonth: event.yearMonth,
        authorizerId: event.authorizerId,
      },
    });
  }

  @OnEvent('payroll.authorized', { async: true })
  async onAuthorized(event: PayrollAuthorizedEvent): Promise<void> {
    this.logger.log(`Queueing audit: payroll authorized ${event.periodId}`);
    await this.pgBossService.sendToQueue('audit-log', {
      userId: event.authorizerId,
      action: 'PAYROLL_AUTHORIZED',
      entityType: 'PayrollPeriod',
      entityId: event.periodId,
      ipAddress: this.requestContext.getIpAddress(),
      userAgent: this.requestContext.getUserAgent(),
      changes: {
        yearMonth: event.yearMonth,
        submitterEmail: event.submitterEmail,
      },
    });
  }

  @OnEvent('payroll.rejected-from-review', { async: true })
  async onRejectedFromReview(event: PayrollReviewRejectedEvent): Promise<void> {
    this.logger.log(`Queueing audit: payroll review rejected ${event.periodId}`);
    await this.pgBossService.sendToQueue('audit-log', {
      userId: event.rejectorId,
      action: 'PAYROLL_REVIEW_REJECTED',
      entityType: 'PayrollPeriod',
      entityId: event.periodId,
      ipAddress: this.requestContext.getIpAddress(),
      userAgent: this.requestContext.getUserAgent(),
      changes: {
        yearMonth: event.yearMonth,
        submitterId: event.submitterId,
        comment: event.comment ?? null,
      },
    });
  }

  @OnEvent('payroll.authorization-revoked', { async: true })
  async onRevoked(event: PayrollAuthorizationRevokedEvent): Promise<void> {
    this.logger.log(`Queueing audit: payroll authorization revoked ${event.periodId}`);
    await this.pgBossService.sendToQueue('audit-log', {
      userId: event.actorId,
      action: 'PAYROLL_AUTHORIZATION_REVOKED',
      entityType: 'PayrollPeriod',
      entityId: event.periodId,
      ipAddress: this.requestContext.getIpAddress(),
      userAgent: this.requestContext.getUserAgent(),
      changes: {
        yearMonth: event.yearMonth,
      },
    });
  }

  @OnEvent('payroll.temp-authorizer-designated', { async: true })
  async onTempAuthorizer(event: PayrollTempAuthorizerDesignatedEvent): Promise<void> {
    this.logger.log(`Queueing audit: temp authorizer ${event.periodId}`);
    await this.pgBossService.sendToQueue('audit-log', {
      userId: event.actorId,
      action: 'PAYROLL_TEMP_AUTHORIZER_DESIGNATED',
      entityType: 'PayrollPeriod',
      entityId: event.periodId,
      ipAddress: this.requestContext.getIpAddress(),
      userAgent: this.requestContext.getUserAgent(),
      changes: {
        yearMonth: event.yearMonth,
        tempAuthorizerId: event.tempAuthorizerId,
      },
    });
  }
}
