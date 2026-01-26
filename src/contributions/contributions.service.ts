import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma';
import { ContributionStatus } from '@prisma/client';
import { CreateContributionDto, ContributionResponseDto } from './dto';

// Reusable select object for contribution queries
const contributionSelect = {
  id: true,
  roleInProject: true,
  task: true,
  action: true,
  toolsTechnologies: true,
  outcome: true,
  keyLearnings: true,
  attachments: true,
  visibilityLevel: true,
  status: true,
  submittedAt: true,
  reviewedAt: true,
  reviewComments: true,
  createdAt: true,
  updatedAt: true,
  user: {
    select: {
      id: true,
      name: true,
      email: true,
    },
  },
  project: {
    select: {
      id: true,
      name: true,
      clientName: true,
    },
  },
  reviewer: {
    select: {
      id: true,
      name: true,
      email: true,
    },
  },
  tags: {
    select: {
      tag: {
        select: {
          id: true,
          name: true,
          category: true,
        },
      },
    },
  },
};

@Injectable()
export class ContributionsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Create a new contribution (defaults to DRAFT status)
   */
  async create(userId: string, dto: CreateContributionDto): Promise<ContributionResponseDto> {
    // Validate project exists
    const project = await this.prisma.project.findUnique({
      where: { id: dto.projectId },
    });

    if (!project) {
      throw new NotFoundException(`Project with ID ${dto.projectId} not found`);
    }

    // Validate tags exist if provided
    if (dto.tagIds && dto.tagIds.length > 0) {
      const existingTags = await this.prisma.tag.findMany({
        where: { id: { in: dto.tagIds } },
        select: { id: true },
      });

      const existingTagIds = existingTags.map((t) => t.id);
      const invalidTagIds = dto.tagIds.filter((id) => !existingTagIds.includes(id));

      if (invalidTagIds.length > 0) {
        throw new NotFoundException(`Tags not found: ${invalidTagIds.join(', ')}`);
      }
    }

    // Create contribution with DRAFT status
    const contribution = await this.prisma.contribution.create({
      data: {
        userId,
        projectId: dto.projectId || 'clx1234567890',
        roleInProject: dto.roleInProject,
        task: dto.task,
        action: dto.action,
        toolsTechnologies: dto.toolsTechnologies || [],
        outcome: dto.outcome,
        keyLearnings: dto.keyLearnings,
        attachments: dto.attachments || [],
        visibilityLevel: dto.visibilityLevel,
        status: ContributionStatus.DRAFT,
        // Create tag associations
        tags: dto.tagIds
          ? {
              create: dto.tagIds.map((tagId) => ({
                tagId,
              })),
            }
          : undefined,
      },
      select: contributionSelect,
    });

    return contribution as ContributionResponseDto;
  }

  /**
   * Get a contribution by ID
   */
  async findOne(id: string, userId?: string): Promise<ContributionResponseDto> {
    const contribution = await this.prisma.contribution.findUnique({
      where: { id },
      select: contributionSelect,
    });

    if (!contribution) {
      throw new NotFoundException(`Contribution with ID ${id} not found`);
    }

    // Check visibility - only owner can see PRIVATE drafts
    if (contribution.visibilityLevel === 'PRIVATE' && contribution.user.id !== userId) {
      throw new ForbiddenException('You do not have access to this contribution');
    }

    return contribution as ContributionResponseDto;
  }

  /**
   * Get all contributions for the current user
   */
  async findMyContributions(userId: string): Promise<ContributionResponseDto[]> {
    const contributions = await this.prisma.contribution.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      select: contributionSelect,
    });

    return contributions as ContributionResponseDto[];
  }
}
