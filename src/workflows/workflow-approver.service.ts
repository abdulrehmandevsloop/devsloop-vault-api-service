import { Injectable, Logger } from '@nestjs/common';
import { ApproverType } from '@prisma/client';
import { PrismaService } from 'src/prisma';
import { AclService } from 'src/rbac/rbac.service';

interface StepSnapshot {
  approverType: ApproverType;
  approverValue: string | null;
  fallbackApproverType: ApproverType | null;
  fallbackApproverValue: string | null;
  isOptional: boolean;
}

@Injectable()
export class WorkflowApproverService {
  private readonly logger = new Logger(WorkflowApproverService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly aclService: AclService,
  ) {}

  async resolveEligibleApproverIds(
    snapshot: StepSnapshot,
    metadata: Record<string, unknown>,
  ): Promise<string[]> {
    const primary = await this.resolveByType(
      snapshot.approverType,
      snapshot.approverValue,
      metadata,
    );

    if (primary.length > 0) return primary;

    if (snapshot.fallbackApproverType) {
      const fallback = await this.resolveByType(
        snapshot.fallbackApproverType,
        snapshot.fallbackApproverValue,
        metadata,
      );
      return fallback;
    }

    return [];
  }

  isUserEligible(userId: string, eligibleApproverIds: string[]): boolean {
    return eligibleApproverIds.includes(userId);
  }

  private async resolveByType(
    approverType: ApproverType,
    approverValue: string | null,
    metadata: Record<string, unknown>,
  ): Promise<string[]> {
    switch (approverType) {
      case 'ROLE': {
        if (!approverValue) return [];
        const assignments = await this.prisma.userRoleAssignment.findMany({
          where: {
            role: { name: approverValue },
            user: { employeeStatus: 'ACTIVE', isSystem: false },
          },
          select: { userId: true },
          distinct: ['userId'],
        });
        return assignments.map((a) => a.userId);
      }

      case 'ENTITY': {
        if (!approverValue) return [];
        return this.aclService.getUserIdsWithEntityAccess(approverValue);
      }

      case 'SPECIFIC_USER': {
        if (!approverValue) return [];
        if (approverValue.startsWith('metadata:')) {
          const field = approverValue.slice('metadata:'.length);
          const userId = metadata[field];
          if (typeof userId === 'string' && userId) return [userId];
          return [];
        }
        return [approverValue];
      }

      default:
        this.logger.warn(`Unknown approverType: ${String(approverType)}`);
        return [];
    }
  }
}
