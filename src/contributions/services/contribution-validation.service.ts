import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class ContributionValidationService {
  constructor(private readonly prisma: PrismaService) {}

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
   * Validate tags exist
   */
  async validateTags(tagIds: string[]): Promise<void> {
    if (!tagIds || tagIds.length === 0) {
      return;
    }

    const existingTags = await this.prisma.tag.findMany({
      where: { id: { in: tagIds } },
      select: { id: true },
    });

    const existingTagIds = existingTags.map((t) => t.id);
    const invalidTagIds = tagIds.filter((id) => !existingTagIds.includes(id));

    if (invalidTagIds.length > 0) {
      throw new NotFoundException(`Tags not found: ${invalidTagIds.join(', ')}`);
    }
  }

  /**
   * Validate user has access to contribution based on visibility
   */
  validateAccess(
    contribution: { visibilityLevel: string; user: { id: string } },
    userId: string,
  ): void {
    if (contribution.visibilityLevel === 'PRIVATE' && contribution.user.id !== userId) {
      throw new ForbiddenException('You do not have access to this contribution');
    }
  }
}
