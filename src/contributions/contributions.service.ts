import { Injectable, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../prisma';
import { ContributionStatus } from '@prisma/client';
import { CreateContributionDto, ContributionResponseDto } from './dto';
import { ContributionValidationService } from './services';
import { CONTRIBUTION_SELECT_FIELDS } from './interfaces';
import { ContributionSubmittedEvent } from './events';

@Injectable()
export class ContributionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly contributionValidationService: ContributionValidationService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  /**
   * Create a new contribution (defaults to DRAFT status)
   */
  async create(userId: string, dto: CreateContributionDto): Promise<ContributionResponseDto> {
    // Validate project and tags
    await this.contributionValidationService.validateProject(dto.projectId);
    if (dto.tagIds) {
      await this.contributionValidationService.validateTags(dto.tagIds);
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
      select: CONTRIBUTION_SELECT_FIELDS,
    });

    return contribution as ContributionResponseDto;
  }

  /**
   * Submit a contribution for review
   */
  async submitContribution(
    contributionId: string,
    userId: string,
  ): Promise<ContributionResponseDto> {
    // Get contribution with user and project details
    const contribution = await this.prisma.contribution.findUnique({
      where: { id: contributionId },
      include: {
        user: { select: { email: true } },
        project: { select: { name: true } },
      },
    });

    if (!contribution) {
      throw new NotFoundException(`Contribution with ID ${contributionId} not found`);
    }

    // Verify ownership
    if (contribution.userId !== userId) {
      throw new NotFoundException(`Contribution with ID ${contributionId} not found`);
    }

    // Update status to PENDING (waiting for review)
    const updatedContribution = await this.prisma.contribution.update({
      where: { id: contributionId },
      data: {
        status: ContributionStatus.PENDING,
        submittedAt: new Date(),
      },
      select: CONTRIBUTION_SELECT_FIELDS,
    });

    // Emit event for notifications and audit (async, non-blocking)
    this.eventEmitter.emit(
      'contribution.submitted',
      new ContributionSubmittedEvent(
        contributionId,
        userId,
        contribution.user.email,
        contribution.projectId,
        contribution.project.name,
      ),
    );

    return updatedContribution as ContributionResponseDto;
  }

  /**
   * Get a contribution by ID
   */
  async findOne(id: string, userId?: string): Promise<ContributionResponseDto> {
    const contribution = await this.prisma.contribution.findUnique({
      where: { id },
      select: CONTRIBUTION_SELECT_FIELDS,
    });

    if (!contribution) {
      throw new NotFoundException(`Contribution with ID ${id} not found`);
    }

    // Check visibility - only owner can see PRIVATE drafts
    if (userId) {
      this.contributionValidationService.validateAccess(contribution, userId);
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
      select: CONTRIBUTION_SELECT_FIELDS,
    });

    return contributions as ContributionResponseDto[];
  }
}
