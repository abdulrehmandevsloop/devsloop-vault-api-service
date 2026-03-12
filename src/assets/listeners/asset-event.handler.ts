import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';

@Injectable()
export class AssetEventHandler {
  private readonly logger = new Logger(AssetEventHandler.name);

  @OnEvent('asset.assigned.notification')
  handleAssigned(payload: {
    assetId: string;
    assetName: string;
    employeeId: string;
    employeeName: string;
    employeeEmail: string;
  }) {
    this.logger.log(
      `Asset assigned: ${payload.assetName} (${payload.assetId}) → ${payload.employeeName} (${payload.employeeEmail})`,
    );
    // Future: send email to employee, in-app notification, Slack
  }

  @OnEvent('asset.returned.notification')
  handleReturned(payload: {
    assetId: string;
    assetName: string;
    userId: string;
    formerEmployeeName: string;
  }) {
    this.logger.log(
      `Asset returned: ${payload.assetName} (${payload.assetId}) by ${payload.formerEmployeeName}`,
    );
    // Future: notify admins, in-app notification
  }

  @OnEvent('asset.issue.reported.notification')
  handleIssueReported(payload: {
    assetId: string;
    assetName: string;
    issueId: string;
    reportedById: string;
    issueType: string;
    priority: string;
  }) {
    this.logger.log(
      `Asset issue reported: ${payload.assetName} (${payload.assetId}) - ${payload.issueType} [${payload.priority}]`,
    );
    // Future: notify IT/admin, email, in-app notification
  }
}
