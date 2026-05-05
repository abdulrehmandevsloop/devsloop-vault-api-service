import { Injectable, Logger } from '@nestjs/common';
import { ApproverType, WorkflowStep } from '@prisma/client';
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

  /**
   * Returns the list of requestType keys for which the user is a potential
   * approver in at least one step of any published workflow template.
   * Checks are done in-memory after loading the user's roles/entities once.
   */
  async getReviewableRequestTypes(userId: string): Promise<string[]> {
    const [userRoleData, templates] = await Promise.all([
      this.prisma.userRoleAssignment.findMany({
        where: { userId, role: { isActive: true } },
        select: {
          role: {
            select: {
              name: true,
              roleEntities: { select: { entity: { select: { name: true } } } },
            },
          },
        },
      }),
      this.prisma.workflowTemplate.findMany({
        where: { isActive: true, isDraft: false },
        include: { steps: true },
      }),
    ]);

    const roleNames = new Set(userRoleData.map((a) => a.role.name));
    const entityNames = new Set(
      userRoleData.flatMap((a) => a.role.roleEntities.map((re) => re.entity.name)),
    );

    const reviewableTypes = new Set<string>();

    for (const template of templates) {
      if (reviewableTypes.has(template.requestType)) continue;
      for (const step of template.steps) {
        if (
          this.stepMatchesUser(
            step.approverType,
            step.approverValue,
            userId,
            roleNames,
            entityNames,
          )
        ) {
          reviewableTypes.add(template.requestType);
          break;
        }
        if (
          step.fallbackApproverType &&
          this.stepMatchesUser(
            step.fallbackApproverType,
            step.fallbackApproverValue,
            userId,
            roleNames,
            entityNames,
          )
        ) {
          reviewableTypes.add(template.requestType);
          break;
        }
      }
    }

    return [...reviewableTypes];
  }

  private stepMatchesUser(
    approverType: ApproverType,
    approverValue: string | null,
    userId: string,
    roleNames: Set<string>,
    entityNames: Set<string>,
  ): boolean {
    if (!approverValue) return false;
    switch (approverType) {
      case 'ROLE':
        return roleNames.has(approverValue);
      case 'ENTITY':
        return entityNames.has(approverValue);
      case 'SPECIFIC_USER':
        if (approverValue.startsWith('metadata:')) return false;
        return approverValue === userId;
      default:
        return false;
    }
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
