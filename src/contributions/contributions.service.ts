import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../prisma';
import { ContributionStatus, VisibilityLevel } from '@prisma/client';
import {
  CreateContributionDto,
  UpdateContributionDto,
  ApproveContributionDto,
  RejectContributionDto,
  ContributionResponseDto,
  ListContributionsQueryDto,
  PaginatedContributionsResponseDto,
  MyContributionsResponseDto,
} from './dto';
import { ContributionValidationService, ContentProcessingService } from './services';
import { CONTRIBUTION_SELECT_FIELDS } from './interfaces';
import {
  ContributionSubmittedEvent,
  ContributionApprovedEvent,
  ContributionRejectedEvent,
} from './events';

/** Allowed status transitions. Invalid transitions are rejected. */
const ALLOWED_TRANSITIONS: Record<ContributionStatus, ContributionStatus[]> = {
  [ContributionStatus.DRAFT]: [ContributionStatus.SUBMITTED],
  [ContributionStatus.SUBMITTED]: [ContributionStatus.APPROVED, ContributionStatus.REJECTED],
  [ContributionStatus.APPROVED]: [],
  [ContributionStatus.REJECTED]: [ContributionStatus.DRAFT], // Author can revert to draft to edit and resubmit; no limit
};

@Injectable()
export class ContributionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly contributionValidationService: ContributionValidationService,
    private readonly contentProcessing: ContentProcessingService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  /**
   * Create a new contribution (defaults to DRAFT status)
   */
  async create(authorId: string, dto: CreateContributionDto): Promise<ContributionResponseDto> {
    await this.contributionValidationService.validateProject(dto.projectId);

    // Sanitize all fields first
    const sanitizedProblem = this.contentProcessing.processPlainTextForStorage(dto.problem);
    const sanitizedSolution = this.contentProcessing.sanitizeRichText(dto.solution);
    const sanitizedOutcome = this.contentProcessing.sanitizeRichText(dto.outcome);
    const sanitizedLearnings = this.contentProcessing.sanitizeRichText(dto.learnings);
    const sanitizedTools = this.contentProcessing.sanitizeToolsArray(dto.toolsAndTechnologies);

    // Validate lengths after sanitization (safety net)
    this.contentProcessing.validateSanitizedLengths({
      problem: sanitizedProblem,
      solution: sanitizedSolution,
      outcome: sanitizedOutcome,
      learnings: sanitizedLearnings,
    });

    const contribution = await this.prisma.contribution.create({
      data: {
        authorId,
        projectId: dto.projectId,
        problem: sanitizedProblem,
        solution: sanitizedSolution,
        outcome: sanitizedOutcome,
        learnings: sanitizedLearnings,
        toolsAndTechnologies: sanitizedTools,
        visibility: dto.visibility ?? VisibilityLevel.PRIVATE,
        status: ContributionStatus.DRAFT,
      },
      select: CONTRIBUTION_SELECT_FIELDS,
    });

    return this.contentProcessing.decompressContribution(contribution) as ContributionResponseDto;
  }

  /**
   * Submit a contribution for review (DRAFT → SUBMITTED).
   * Only the author can submit.
   */
  async submitContribution(
    contributionId: string,
    authorId: string,
  ): Promise<ContributionResponseDto> {
    await this.verifyOwnership(contributionId, authorId);

    const contribution = await this.prisma.contribution.findUnique({
      where: { id: contributionId },
      include: {
        author: { select: { email: true } },
        project: { select: { name: true } },
      },
    });

    if (!contribution) {
      throw new NotFoundException(`Contribution with ID ${contributionId} not found`);
    }

    this.validateStatusTransition(contribution.status, ContributionStatus.SUBMITTED);

    const updatedContribution = await this.prisma.contribution.update({
      where: { id: contributionId },
      data: { status: ContributionStatus.SUBMITTED },
      select: CONTRIBUTION_SELECT_FIELDS,
    });

    this.eventEmitter.emit(
      'contribution.submitted',
      new ContributionSubmittedEvent(
        contributionId,
        authorId,
        contribution.author.email,
        contribution.projectId,
        contribution.project.name,
      ),
    );

    return this.contentProcessing.decompressContribution(
      updatedContribution,
    ) as ContributionResponseDto;
  }

  /**
   * Approve a contribution (SUBMITTED → APPROVED).
   * Only users assigned to the contribution's project (as reviewer) can approve. Requires reviewer comment.
   */
  async approveContribution(
    contributionId: string,
    reviewerId: string,
    dto: ApproveContributionDto,
  ): Promise<ContributionResponseDto> {
    await this.verifyReviewerAssignment(contributionId, reviewerId);
    const comment = dto.reviewerComment?.trim();
    if (!comment) {
      throw new BadRequestException('Reviewer comment is required when approving a contribution');
    }
    return this.applyReviewTransition(
      contributionId,
      ContributionStatus.APPROVED,
      reviewerId,
      comment,
    );
  }

  /**
   * Reject a contribution (SUBMITTED → REJECTED).
   * Only users assigned to the contribution's project (as reviewer) can reject. Requires reviewer comment.
   */
  async rejectContribution(
    contributionId: string,
    reviewerId: string,
    dto: RejectContributionDto,
  ): Promise<ContributionResponseDto> {
    await this.verifyReviewerAssignment(contributionId, reviewerId);
    const comment = dto.reviewerComment?.trim();
    if (!comment) {
      throw new BadRequestException('Reviewer comment is required when rejecting a contribution');
    }
    return this.applyReviewTransition(
      contributionId,
      ContributionStatus.REJECTED,
      reviewerId,
      comment,
    );
  }

  /**
   * Get a contribution by ID. Data exposure is controlled by visibility:
   * visibility is persisted on the contribution and applied in this read query.
   * Caller must be authenticated so visibility can be enforced.
   */
  async findOne(id: string, currentUserId?: string): Promise<ContributionResponseDto> {
    const contribution = await this.prisma.contribution.findUnique({
      where: { id },
      select: CONTRIBUTION_SELECT_FIELDS,
    });

    if (!contribution) {
      throw new NotFoundException(`Contribution with ID ${id} not found`);
    }

    if (!currentUserId) {
      throw new ForbiddenException('Authentication required to view contributions');
    }
    await this.contributionValidationService.validateAccess(contribution, currentUserId);

    return this.contentProcessing.decompressContribution(contribution) as ContributionResponseDto;
  }

  /**
   * Get paginated contributions for the current user with status counts.
   * Optionally filter by status. Counts are always for all statuses regardless of filter.
   */
  async findMyContributions(
    authorId: string,
    page: number = 1,
    limit: number = 20,
    status?: ContributionStatus,
  ): Promise<MyContributionsResponseDto> {
    const skip = (page - 1) * limit;

    // Base where clause
    const baseWhere = { authorId };

    // Where clause for filtered contributions (with status filter if provided)
    const contributionWhere = status ? { ...baseWhere, status } : baseWhere;

    // Get counts for all statuses (always for all contributions, regardless of filter)
    // and paginated contributions (filtered by status if provided)
    const [draftCount, submittedCount, approvedCount, rejectedCount, contributions, total] =
      await Promise.all([
        // Count draft
        this.prisma.contribution.count({
          where: { ...baseWhere, status: ContributionStatus.DRAFT },
        }),
        // Count submitted (pending)
        this.prisma.contribution.count({
          where: { ...baseWhere, status: ContributionStatus.SUBMITTED },
        }),
        // Count approved
        this.prisma.contribution.count({
          where: { ...baseWhere, status: ContributionStatus.APPROVED },
        }),
        // Count rejected
        this.prisma.contribution.count({
          where: { ...baseWhere, status: ContributionStatus.REJECTED },
        }),
        // Get paginated contributions (with status filter if provided)
        this.prisma.contribution.findMany({
          where: contributionWhere,
          orderBy: { createdAt: 'desc' },
          select: CONTRIBUTION_SELECT_FIELDS,
          skip,
          take: limit,
        }),
        // Get total count (matching the status filter)
        this.prisma.contribution.count({ where: contributionWhere }),
      ]);

    const totalPages = Math.ceil(total / limit) || 1;

    return {
      data: this.contentProcessing.decompressContributions(
        contributions,
      ) as ContributionResponseDto[],
      draft: draftCount,
      submitted: submittedCount,
      approved: approvedCount,
      rejected: rejectedCount,
      total,
      page,
      limit,
      totalPages,
      hasNextPage: page < totalPages,
      hasPreviousPage: page > 1,
    };
  }

  /**
   * Get paginated contributions for projects the user is assigned to as reviewer.
   * Filter by project (projectId) and/or status. By default, shows pending (SUBMITTED) only.
   * Reviewers are determined by project assignment (admin assigns users to projects), not by static role.
   * Returns paginated contributions along with counts for pending, approved, and rejected contributions.
   */
  async findPendingContributions(
    reviewerId: string,
    projectId?: string,
    status?: ContributionStatus,
    page: number = 1,
    limit: number = 20,
  ): Promise<{
    contributions: ContributionResponseDto[];
    pending: number;
    approved: number;
    rejected: number;
    total: number;
    page: number;
    limit: number;
    totalPages: number;
    hasNextPage: boolean;
    hasPreviousPage: boolean;
  }> {
    const assigned = await (this.prisma as any).userProject.findMany({
      where: { userId: reviewerId },
      select: { projectId: true },
    });
    const assignedProjectIds = assigned.map((a: { projectId: string }) => a.projectId);

    if (assignedProjectIds.length === 0) {
      return {
        contributions: [],
        pending: 0,
        approved: 0,
        rejected: 0,
        total: 0,
        page,
        limit,
        totalPages: 0,
        hasNextPage: false,
        hasPreviousPage: false,
      };
    }

    // Base where clause for project filtering
    const projectWhere: { projectId: { in: string[] } | string } = {
      projectId: { in: assignedProjectIds },
    };

    // Filter by specific project if provided (must be in assigned projects)
    if (projectId) {
      if (!assignedProjectIds.includes(projectId)) {
        return {
          contributions: [],
          pending: 0,
          approved: 0,
          rejected: 0,
          total: 0,
          page,
          limit,
          totalPages: 0,
          hasNextPage: false,
          hasPreviousPage: false,
        };
      }
      projectWhere.projectId = projectId;
    }

    // Where clause for filtered contributions (with status filter)
    const contributionWhere = {
      ...projectWhere,
      status: status ?? ContributionStatus.SUBMITTED,
    };

    const skip = (page - 1) * limit;

    // Get counts for all three statuses (for the filtered projects) and paginated contributions
    const [pendingCount, approvedCount, rejectedCount, contributions, total] = await Promise.all([
      // Count pending (SUBMITTED)
      this.prisma.contribution.count({
        where: {
          ...projectWhere,
          status: ContributionStatus.SUBMITTED,
        },
      }),
      // Count approved (APPROVED)
      this.prisma.contribution.count({
        where: {
          ...projectWhere,
          status: ContributionStatus.APPROVED,
        },
      }),
      // Count rejected (REJECTED)
      this.prisma.contribution.count({
        where: {
          ...projectWhere,
          status: ContributionStatus.REJECTED,
        },
      }),
      // Get paginated contributions with status filter
      this.prisma.contribution.findMany({
        where: contributionWhere,
        orderBy: { createdAt: 'desc' },
        select: CONTRIBUTION_SELECT_FIELDS,
        skip,
        take: limit,
      }),
      // Get total count for pagination (matching the status filter)
      this.prisma.contribution.count({
        where: contributionWhere,
      }),
    ]);

    const totalPages = Math.ceil(total / limit) || 1;

    return {
      contributions: this.contentProcessing.decompressContributions(
        contributions,
      ) as ContributionResponseDto[],
      pending: pendingCount,
      approved: approvedCount,
      rejected: rejectedCount,
      total,
      page,
      limit,
      totalPages,
      hasNextPage: page < totalPages,
      hasPreviousPage: page > 1,
    };
  }

  /**
   * List contributions for a reviewer with filters. Reviewer sees only contributions
   * for projects they are assigned to. Filter by project and/or status (pending/approved/rejected).
   */
  async findForReviewer(
    reviewerId: string,
    query: ListContributionsQueryDto,
  ): Promise<PaginatedContributionsResponseDto> {
    const assigned = await (this.prisma as any).userProject.findMany({
      where: { userId: reviewerId },
      select: { projectId: true },
    });
    const assignedProjectIds = assigned.map((a: { projectId: string }) => a.projectId);

    if (assignedProjectIds.length === 0) {
      return {
        data: [],
        total: 0,
        page: query.page ?? 1,
        limit: query.limit ?? 20,
        totalPages: 0,
        hasNextPage: false,
        hasPreviousPage: false,
      };
    }

    const where: { projectId: { in: string[] } | string; status?: ContributionStatus } = {
      projectId: { in: assignedProjectIds },
    };
    if (query.projectId) {
      if (!assignedProjectIds.includes(query.projectId)) {
        return {
          data: [],
          total: 0,
          page: query.page ?? 1,
          limit: query.limit ?? 20,
          totalPages: 0,
          hasNextPage: false,
          hasPreviousPage: false,
        };
      }
      where.projectId = query.projectId;
    }
    if (query.status) {
      where.status = query.status;
    }

    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const skip = (page - 1) * limit;

    const [contributions, total] = await Promise.all([
      this.prisma.contribution.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        select: CONTRIBUTION_SELECT_FIELDS,
        skip,
        take: limit,
      }),
      this.prisma.contribution.count({ where }),
    ]);

    const totalPages = Math.ceil(total / limit) || 1;

    return {
      data: this.contentProcessing.decompressContributions(
        contributions,
      ) as ContributionResponseDto[],
      total,
      page,
      limit,
      totalPages,
      hasNextPage: page < totalPages,
      hasPreviousPage: page > 1,
    };
  }

  /**
   * Update a contribution (only author can update, only DRAFT status)
   */
  async update(
    contributionId: string,
    authorId: string,
    dto: UpdateContributionDto,
  ): Promise<ContributionResponseDto> {
    await this.verifyCanEdit(contributionId, authorId);

    // Validate project if projectId is being updated
    if (dto.projectId !== undefined) {
      await this.contributionValidationService.validateProject(dto.projectId);
    }

    // Sanitize fields that are being updated
    const sanitizedFields: {
      problem?: string;
      solution?: string;
      outcome?: string;
      learnings?: string;
    } = {};

    const updateData: Record<string, unknown> = {};
    if (dto.projectId !== undefined) updateData.projectId = dto.projectId;
    if (dto.problem !== undefined) {
      sanitizedFields.problem = this.contentProcessing.processPlainTextForStorage(dto.problem);
      updateData.problem = sanitizedFields.problem;
    }
    if (dto.solution !== undefined) {
      sanitizedFields.solution = this.contentProcessing.sanitizeRichText(dto.solution);
      updateData.solution = sanitizedFields.solution;
    }
    if (dto.outcome !== undefined) {
      sanitizedFields.outcome = this.contentProcessing.sanitizeRichText(dto.outcome);
      updateData.outcome = sanitizedFields.outcome;
    }
    if (dto.learnings !== undefined) {
      sanitizedFields.learnings = this.contentProcessing.sanitizeRichText(dto.learnings);
      updateData.learnings = sanitizedFields.learnings;
    }
    if (dto.toolsAndTechnologies !== undefined)
      updateData.toolsAndTechnologies = this.contentProcessing.sanitizeToolsArray(
        dto.toolsAndTechnologies,
      );
    if (dto.visibility !== undefined) updateData.visibility = dto.visibility;

    // Validate lengths after sanitization (safety net)
    if (Object.keys(sanitizedFields).length > 0) {
      this.contentProcessing.validateSanitizedLengths(sanitizedFields);
    }

    const contribution = await this.prisma.contribution.update({
      where: { id: contributionId },
      data: updateData,
      select: CONTRIBUTION_SELECT_FIELDS,
    });

    return this.contentProcessing.decompressContribution(contribution) as ContributionResponseDto;
  }

  /**
   * Revert a REJECTED contribution to DRAFT so the author can edit and resubmit.
   * Only the author can revert. Reviewer comment, reviewerId, and reviewedAt are preserved
   * so the author can still see the rejection feedback. No resubmission limit; same reviewer
   * may reject again after resubmit.
   */
  async revertToDraft(contributionId: string, authorId: string): Promise<ContributionResponseDto> {
    await this.verifyOwnership(contributionId, authorId);

    const contribution = await this.prisma.contribution.findUnique({
      where: { id: contributionId },
      select: { id: true, status: true },
    });

    if (!contribution) {
      throw new NotFoundException(`Contribution with ID ${contributionId} not found`);
    }

    if (contribution.status !== ContributionStatus.REJECTED) {
      throw new BadRequestException(
        `Cannot revert to draft: contribution status is '${contribution.status}'. Only REJECTED contributions can be reverted.`,
      );
    }

    this.validateStatusTransition(contribution.status, ContributionStatus.DRAFT);

    const updated = await this.prisma.contribution.update({
      where: { id: contributionId },
      data: { status: ContributionStatus.DRAFT },
      select: CONTRIBUTION_SELECT_FIELDS,
    });

    return this.contentProcessing.decompressContribution(updated) as ContributionResponseDto;
  }

  /**
   * Delete a contribution (only author can delete, cannot delete if reviewed)
   */
  async delete(contributionId: string, authorId: string): Promise<void> {
    // Verify ownership - throws if not owner
    await this.verifyOwnership(contributionId, authorId);

    // Check if contribution has been reviewed
    const contribution = await this.prisma.contribution.findUnique({
      where: { id: contributionId },
      select: { id: true, reviewerId: true, reviewedAt: true },
    });

    if (!contribution) {
      throw new NotFoundException(`Contribution with ID ${contributionId} not found`);
    }

    // Prevent deletion if contribution has been reviewed by any reviewer
    if (contribution.reviewerId && contribution.reviewedAt) {
      throw new ForbiddenException(
        'Cannot delete this contribution because it has been reviewed by a reviewer. Reviewed contributions cannot be deleted.',
      );
    }

    await this.prisma.contribution.delete({
      where: { id: contributionId },
    });
  }

  /**
   * Verify that the user is the owner of the contribution
   * @throws NotFoundException if contribution doesn't exist
   * @throws ForbiddenException if user is not the owner
   */
  private async verifyOwnership(contributionId: string, authorId: string): Promise<void> {
    const contribution = await this.prisma.contribution.findUnique({
      where: { id: contributionId },
      select: { id: true, authorId: true },
    });

    if (!contribution) {
      throw new NotFoundException(`Contribution with ID ${contributionId} not found`);
    }

    if (contribution.authorId !== authorId) {
      throw new ForbiddenException('You are not authorized to modify this contribution');
    }
  }

  /**
   * Verify that the user is assigned as reviewer to the contribution's project.
   * Reviewers are assigned by admin (UserProject); there are no static roles like TEAM_LEAD.
   * @throws NotFoundException if contribution doesn't exist
   * @throws ForbiddenException if user is not assigned to the contribution's project
   */
  private async verifyReviewerAssignment(contributionId: string, userId: string): Promise<void> {
    const contribution = await this.prisma.contribution.findUnique({
      where: { id: contributionId },
      select: { id: true, projectId: true },
    });

    if (!contribution) {
      throw new NotFoundException(`Contribution with ID ${contributionId} not found`);
    }

    const assignment = await (this.prisma as any).userProject.findUnique({
      where: {
        userId_projectId: { userId, projectId: contribution.projectId },
      },
    });

    if (!assignment) {
      throw new ForbiddenException(
        "You are not assigned as a reviewer for this contribution's project. Only users assigned to the project can approve or reject.",
      );
    }
  }

  /**
   * Verify that the user can edit the contribution (ownership + DRAFT status)
   * @throws NotFoundException if contribution doesn't exist
   * @throws ForbiddenException if user is not the owner
   * @throws BadRequestException if contribution is not in DRAFT status
   */
  private async verifyCanEdit(contributionId: string, authorId: string): Promise<void> {
    const contribution = await this.prisma.contribution.findUnique({
      where: { id: contributionId },
      select: { id: true, authorId: true, status: true },
    });

    if (!contribution) {
      throw new NotFoundException(`Contribution with ID ${contributionId} not found`);
    }

    if (contribution.authorId !== authorId) {
      throw new ForbiddenException('You are not authorized to modify this contribution');
    }

    if (contribution.status !== ContributionStatus.DRAFT) {
      throw new BadRequestException(
        `Cannot update contribution with status '${contribution.status}'. Only DRAFT contributions can be edited.`,
      );
    }
  }

  /**
   * Validate that a status transition is allowed.
   * Allowed: DRAFT→SUBMITTED, SUBMITTED→APPROVED, SUBMITTED→REJECTED, REJECTED→DRAFT.
   * @throws BadRequestException if transition is invalid
   */
  private validateStatusTransition(from: ContributionStatus, to: ContributionStatus): void {
    const allowed = ALLOWED_TRANSITIONS[from];
    if (!allowed?.includes(to)) {
      throw new BadRequestException(
        `Invalid status transition: cannot change from '${from}' to '${to}'. ` +
          `Allowed: DRAFT→SUBMITTED, SUBMITTED→APPROVED, SUBMITTED→REJECTED, REJECTED→DRAFT.`,
      );
    }
  }

  /**
   * Apply SUBMITTED→APPROVED or SUBMITTED→REJECTED. Validates transition, updates contribution, emits event.
   * For REJECTED, reviewerComment must be provided (enforced by rejectContribution).
   */
  private async applyReviewTransition(
    contributionId: string,
    toStatus: 'APPROVED' | 'REJECTED',
    reviewerId: string,
    reviewerComment?: string,
  ): Promise<ContributionResponseDto> {
    const contribution = await this.prisma.contribution.findUnique({
      where: { id: contributionId },
      include: {
        author: { select: { id: true, email: true } },
        project: { select: { id: true, name: true } },
      },
    });

    if (!contribution) {
      throw new NotFoundException(`Contribution with ID ${contributionId} not found`);
    }

    this.validateStatusTransition(contribution.status, toStatus);

    const reviewer = await this.prisma.user.findUnique({
      where: { id: reviewerId },
      select: { name: true },
    });
    const reviewerName = reviewer?.name ?? 'Unknown';

    const reviewerCommentValue =
      reviewerComment && reviewerComment.trim() ? reviewerComment.trim() : null;

    // Increment rejectionCount if status is REJECTED
    const updateData: Record<string, unknown> = {
      status: toStatus,
      reviewerId,
      reviewedAt: new Date(),
      reviewerComment: reviewerCommentValue,
    };

    if (toStatus === ContributionStatus.REJECTED) {
      updateData.rejectionCount = {
        increment: 1,
      };
    }

    const updatedContribution = await this.prisma.contribution.update({
      where: { id: contributionId },
      data: updateData,
      select: CONTRIBUTION_SELECT_FIELDS,
    });

    if (toStatus === ContributionStatus.APPROVED) {
      this.eventEmitter.emit(
        'contribution.approved',
        new ContributionApprovedEvent(
          contributionId,
          contribution.authorId,
          contribution.author.email,
          reviewerId,
          reviewerName,
          contribution.projectId,
          reviewerCommentValue,
        ),
      );
    } else {
      this.eventEmitter.emit(
        'contribution.rejected',
        new ContributionRejectedEvent(
          contributionId,
          contribution.authorId,
          contribution.author.email,
          reviewerId,
          reviewerName,
          reviewerCommentValue!,
        ),
      );
    }

    return this.contentProcessing.decompressContribution(
      updatedContribution,
    ) as ContributionResponseDto;
  }
}
