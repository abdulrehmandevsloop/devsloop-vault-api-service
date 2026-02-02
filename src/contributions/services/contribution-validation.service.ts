import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AclService } from '../../rbac/rbac.service';

@Injectable()
export class ContributionValidationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly aclService: AclService,
  ) {}

  /**
   * Validate project exists
   */
  async validateProject(projectId: string): Promise<void> {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
    });

    if (!project) {
      throw new NotFoundException(`Project with ID ${projectId} not found`);
    }
  }

  /**
   * Control data exposure: enforce visibility in read queries.
   * Visibility is persisted on create/update and used here when fetching by ID.
   * - PRIVATE: only the author can see (unless user has contribution-review entity).
   * - INTERNAL / PUBLIC_ELIGIBLE: any authenticated user can see (e.g. reviewers, colleagues).
   *
   * Reviewers with 'contribution-review' entity can access all contributions regardless of visibility.
   */
  async validateAccess(
    contribution: { visibility: string; author: { id: string } },
    currentUserId: string,
  ): Promise<void> {
    // Author can always access their own contributions
    if (contribution.author.id === currentUserId) {
      return;
    }

    // Check if user has contribution-review entity (reviewers can see all contributions)
    const hasReviewAccess = await this.aclService.userHasEntityAccess(
      currentUserId,
      'contribution-review',
    );

    if (hasReviewAccess) {
      return; // Reviewers bypass visibility restrictions
    }

    // For non-reviewers, enforce PRIVATE visibility
    if (contribution.visibility === 'PRIVATE') {
      throw new ForbiddenException('You do not have access to this contribution');
    }
  }
}
