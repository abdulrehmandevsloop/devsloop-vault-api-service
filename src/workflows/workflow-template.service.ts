import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from 'src/prisma';
import {
  CreateWorkflowTemplateDto,
  QueryWorkflowTemplatesDto,
  UpdateWorkflowTemplateDto,
} from './dto';

@Injectable()
export class WorkflowTemplateService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateWorkflowTemplateDto) {
    return this.prisma.workflowTemplate.create({
      data: {
        name: dto.name,
        description: dto.description,
        requestType: dto.requestType,
        departments: dto.departments ?? [],
        employeeTypes: dto.employeeTypes ?? [],
        allowEditAfterSubmit: dto.allowEditAfterSubmit ?? false,
        preventConsecutiveApproval: dto.preventConsecutiveApproval ?? true,
        maxReturnCount: dto.maxReturnCount ?? 3,
        steps: { create: dto.steps },
      },
      include: { steps: { orderBy: { order: 'asc' } } },
    });
  }

  async findAll(query: QueryWorkflowTemplatesDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const skip = (page - 1) * limit;

    const where = {
      isActive: true,
      ...(query.requestType ? { requestType: query.requestType } : {}),
    };

    const [data, total] = await this.prisma.$transaction([
      this.prisma.workflowTemplate.findMany({
        where,
        include: { steps: { orderBy: { order: 'asc' } } },
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.workflowTemplate.count({ where }),
    ]);

    return { data, total, page, limit };
  }

  async findOne(id: string) {
    const template = await this.prisma.workflowTemplate.findUnique({
      where: { id },
      include: { steps: { orderBy: { order: 'asc' } } },
    });
    if (!template) throw new NotFoundException('Workflow template not found');
    return template;
  }

  async update(id: string, dto: UpdateWorkflowTemplateDto) {
    await this.findOne(id);

    const { steps, ...templateFields } = dto;

    return this.prisma.$transaction(async (tx) => {
      if (steps !== undefined) {
        await tx.workflowStep.deleteMany({ where: { templateId: id } });
      }

      return tx.workflowTemplate.update({
        where: { id },
        data: {
          ...templateFields,
          version: { increment: 1 },
          ...(steps !== undefined ? { steps: { create: steps } } : {}),
        },
        include: { steps: { orderBy: { order: 'asc' } } },
      });
    });
  }

  async deactivate(id: string) {
    await this.findOne(id);

    const activeCount = await this.prisma.workflowInstance.count({
      where: {
        templateId: id,
        status: { in: ['PENDING', 'IN_PROGRESS', 'RETURNED'] },
      },
    });

    if (activeCount > 0) {
      throw new BadRequestException(
        `Cannot deactivate template — ${activeCount} requests are currently in progress`,
      );
    }

    return this.prisma.workflowTemplate.update({
      where: { id },
      data: { isActive: false },
    });
  }
}
