import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import {
  AssetCreatedEvent,
  AssetUpdatedEvent,
  AssetDeletedEvent,
  AssetAssignedEvent,
  AssetReturnedEvent,
  AssetQuantityUpdatedEvent,
  AssetTypeCreatedEvent,
  AssetTypeUpdatedEvent,
  AssetTypeDeletedEvent,
  AssetIssueReportedEvent,
  AssetIssueResolvedEvent,
} from 'src/assets/events';
import { PgBossService } from 'src/queue/pg-boss.service';
import { RequestContextService } from 'src/common/services/request-context.service';

@Injectable()
export class AssetAuditHandler {
  private readonly logger = new Logger(AssetAuditHandler.name);

  constructor(
    private readonly pgBossService: PgBossService,
    private readonly requestContext: RequestContextService,
  ) {}

  @OnEvent('asset.created', { async: true })
  async handleAssetCreated(event: AssetCreatedEvent) {
    this.logger.log(`Queueing audit log for asset creation: ${event.assetId}`);

    await this.pgBossService.sendToQueue('audit-log', {
      userId: event.performedBy,
      action: 'ASSET_CREATED',
      entityType: 'Asset',
      entityId: event.assetId,
      ipAddress: this.requestContext.getIpAddress(),
      userAgent: this.requestContext.getUserAgent(),
      changes: {
        assetName: event.assetName,
        serialNumber: event.serialNumber,
        assetTypeName: event.assetTypeName,
        quantity: event.quantity,
        timestamp: event.timestamp.toISOString(),
      },
    });
  }

  @OnEvent('asset.updated', { async: true })
  async handleAssetUpdated(event: AssetUpdatedEvent) {
    this.logger.log(`Queueing audit log for asset update: ${event.assetId}`);

    await this.pgBossService.sendToQueue('audit-log', {
      userId: event.performedBy,
      action: 'ASSET_UPDATED',
      entityType: 'Asset',
      entityId: event.assetId,
      ipAddress: this.requestContext.getIpAddress(),
      userAgent: this.requestContext.getUserAgent(),
      changes: {
        assetName: event.assetName,
        changedFields: event.changedFields,
        timestamp: event.timestamp.toISOString(),
      },
    });
  }

  @OnEvent('asset.deleted', { async: true })
  async handleAssetDeleted(event: AssetDeletedEvent) {
    this.logger.log(`Queueing audit log for asset deletion: ${event.assetId}`);

    await this.pgBossService.sendToQueue('audit-log', {
      userId: event.performedBy,
      action: 'ASSET_DELETED',
      entityType: 'Asset',
      entityId: event.assetId,
      ipAddress: this.requestContext.getIpAddress(),
      userAgent: this.requestContext.getUserAgent(),
      changes: {
        assetName: event.assetName,
        serialNumber: event.serialNumber,
        timestamp: event.timestamp.toISOString(),
      },
    });
  }

  @OnEvent('asset.assigned', { async: true })
  async handleAssetAssigned(event: AssetAssignedEvent) {
    this.logger.log(`Queueing audit log for asset assignment: ${event.assetId}`);

    await this.pgBossService.sendToQueue('audit-log', {
      userId: event.performedBy,
      action: 'ASSET_ASSIGNED',
      entityType: 'Asset',
      entityId: event.assetId,
      ipAddress: this.requestContext.getIpAddress(),
      userAgent: this.requestContext.getUserAgent(),
      changes: {
        assetName: event.assetName,
        employeeIds: event.employeeIds,
        employeeNames: event.employeeNames,
        employeeCount: event.employeeIds.length,
        timestamp: event.timestamp.toISOString(),
      },
    });
  }

  @OnEvent('asset.returned', { async: true })
  async handleAssetReturned(event: AssetReturnedEvent) {
    this.logger.log(`Queueing audit log for asset return: ${event.assetId}`);

    await this.pgBossService.sendToQueue('audit-log', {
      userId: event.performedBy,
      action: 'ASSET_RETURNED',
      entityType: 'Asset',
      entityId: event.assetId,
      ipAddress: this.requestContext.getIpAddress(),
      userAgent: this.requestContext.getUserAgent(),
      changes: {
        assetName: event.assetName,
        employeeIds: event.employeeIds,
        employeeNames: event.employeeNames,
        employeeCount: event.employeeIds.length,
        timestamp: event.timestamp.toISOString(),
      },
    });
  }

  @OnEvent('asset.quantity.updated', { async: true })
  async handleAssetQuantityUpdated(event: AssetQuantityUpdatedEvent) {
    this.logger.log(`Queueing audit log for asset quantity update: ${event.assetId}`);

    await this.pgBossService.sendToQueue('audit-log', {
      userId: event.performedBy,
      action: 'ASSET_QUANTITY_UPDATED',
      entityType: 'Asset',
      entityId: event.assetId,
      ipAddress: this.requestContext.getIpAddress(),
      userAgent: this.requestContext.getUserAgent(),
      changes: {
        assetName: event.assetName,
        oldQuantity: event.oldQuantity,
        newQuantity: event.newQuantity,
        timestamp: event.timestamp.toISOString(),
      },
    });
  }

  @OnEvent('asset-type.created', { async: true })
  async handleAssetTypeCreated(event: AssetTypeCreatedEvent) {
    this.logger.log(`Queueing audit log for asset type creation: ${event.assetTypeId}`);

    await this.pgBossService.sendToQueue('audit-log', {
      userId: event.performedBy,
      action: 'ASSET_TYPE_CREATED',
      entityType: 'AssetType',
      entityId: event.assetTypeId,
      ipAddress: this.requestContext.getIpAddress(),
      userAgent: this.requestContext.getUserAgent(),
      changes: {
        assetTypeName: event.assetTypeName,
        timestamp: event.timestamp.toISOString(),
      },
    });
  }

  @OnEvent('asset-type.updated', { async: true })
  async handleAssetTypeUpdated(event: AssetTypeUpdatedEvent) {
    this.logger.log(`Queueing audit log for asset type update: ${event.assetTypeId}`);

    await this.pgBossService.sendToQueue('audit-log', {
      userId: event.performedBy,
      action: 'ASSET_TYPE_UPDATED',
      entityType: 'AssetType',
      entityId: event.assetTypeId,
      ipAddress: this.requestContext.getIpAddress(),
      userAgent: this.requestContext.getUserAgent(),
      changes: {
        assetTypeName: event.assetTypeName,
        changedFields: event.changedFields,
        timestamp: event.timestamp.toISOString(),
      },
    });
  }

  @OnEvent('asset-type.deleted', { async: true })
  async handleAssetTypeDeleted(event: AssetTypeDeletedEvent) {
    this.logger.log(`Queueing audit log for asset type deletion: ${event.assetTypeId}`);

    await this.pgBossService.sendToQueue('audit-log', {
      userId: event.performedBy,
      action: 'ASSET_TYPE_DELETED',
      entityType: 'AssetType',
      entityId: event.assetTypeId,
      ipAddress: this.requestContext.getIpAddress(),
      userAgent: this.requestContext.getUserAgent(),
      changes: {
        assetTypeName: event.assetTypeName,
        timestamp: event.timestamp.toISOString(),
      },
    });
  }

  @OnEvent('asset.issue.reported', { async: true })
  async handleAssetIssueReported(event: AssetIssueReportedEvent) {
    this.logger.log(`Queueing audit log for asset issue reported: ${event.issueId}`);

    await this.pgBossService.sendToQueue('audit-log', {
      userId: event.reportedBy,
      action: 'ASSET_ISSUE_REPORTED',
      entityType: 'AssetIssue',
      entityId: event.issueId,
      ipAddress: this.requestContext.getIpAddress(),
      userAgent: this.requestContext.getUserAgent(),
      changes: {
        assetId: event.assetId,
        assetName: event.assetName,
        issueType: event.issueType,
        priority: event.priority,
        timestamp: event.timestamp.toISOString(),
      },
    });
  }

  @OnEvent('asset.issue.resolved', { async: true })
  async handleAssetIssueResolved(event: AssetIssueResolvedEvent) {
    this.logger.log(`Queueing audit log for asset issue resolved: ${event.issueId}`);

    await this.pgBossService.sendToQueue('audit-log', {
      userId: event.resolvedBy,
      action: 'ASSET_ISSUE_RESOLVED',
      entityType: 'AssetIssue',
      entityId: event.issueId,
      ipAddress: this.requestContext.getIpAddress(),
      userAgent: this.requestContext.getUserAgent(),
      changes: {
        assetId: event.assetId,
        assetName: event.assetName,
        timestamp: event.timestamp.toISOString(),
      },
    });
  }
}
