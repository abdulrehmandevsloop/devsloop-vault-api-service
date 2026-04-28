import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { RequestType, WorkflowTemplate } from '@prisma/client';
import { PrismaService } from 'src/prisma';

type TemplateWithSteps = WorkflowTemplate & {
  steps: import('@prisma/client').WorkflowStep[];
};

@Injectable()
export class WorkflowResolverService {
  private readonly logger = new Logger(WorkflowResolverService.name);

  constructor(private readonly prisma: PrismaService) {}

  async resolveTemplate(requestType: RequestType, requesterId: string): Promise<TemplateWithSteps> {
    const requester = await this.prisma.user.findUnique({
      where: { id: requesterId },
      select: { departments: true, employeeType: true },
    });

    const requesterDepts = requester?.departments ?? [];
    const requesterType = requester?.employeeType ?? null;

    const templates = await this.prisma.workflowTemplate.findMany({
      where: { requestType, isActive: true },
      include: { steps: { orderBy: { order: 'asc' } } },
    });

    const scored = templates
      .filter((t) => this.matchesRequester(t, requesterDepts, requesterType))
      .map((t) => ({ template: t, score: this.specificity(t) }))
      .sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        // tie-break: prefer isDefault
        return Number(b.template.isDefault) - Number(a.template.isDefault);
      });

    if (scored.length === 0) {
      this.logger.warn(
        `No workflow template found for ${requestType} (requesterId=${requesterId})`,
      );
      throw new BadRequestException(
        `No workflow template configured for ${requestType} requests. Please contact your administrator to set up an approval workflow.`,
      );
    }

    return scored[0].template;
  }

  private matchesRequester(
    template: WorkflowTemplate,
    requesterDepts: string[],
    requesterType: string | null,
  ): boolean {
    const deptMatch =
      template.departments.length === 0 ||
      requesterDepts.some((d) => template.departments.includes(d));

    const typeMatch =
      template.employeeTypes.length === 0 ||
      (requesterType !== null && template.employeeTypes.includes(requesterType));

    return deptMatch && typeMatch;
  }

  private specificity(template: WorkflowTemplate): number {
    const hasDepts = template.departments.length > 0 ? 1 : 0;
    const hasTypes = template.employeeTypes.length > 0 ? 1 : 0;
    return hasDepts + hasTypes;
  }
}
