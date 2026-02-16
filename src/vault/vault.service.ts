import { Injectable, NotFoundException } from '@nestjs/common';
import { ContributionStatus } from '@prisma/client';
import { PrismaService } from '../prisma';
import {
  VaultProjectsResponseDto,
  VaultContributionQueryDto,
  VaultContributionsResponseDto,
} from './dto';

@Injectable()
export class VaultService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Get all projects that have at least one approved contribution.
   * Returns project info with count of approved contributions, sorted by name.
   */
  async getProjects(): Promise<VaultProjectsResponseDto> {
    const projects = await this.prisma.project.findMany({
      where: {
        contributions: {
          some: {
            status: ContributionStatus.APPROVED,
          },
        },
      },
      select: {
        id: true,
        name: true,
        clientName: true,
        domain: true,
        description: true,
        confidentialityLevel: true,
        _count: {
          select: {
            contributions: {
              where: { status: ContributionStatus.APPROVED },
            },
          },
        },
      },
      orderBy: { name: 'asc' },
    });

    const data = projects.map((project) => ({
      id: project.id,
      name: project.name,
      clientName: project.clientName,
      domain: project.domain,
      description: project.description,
      confidentialityLevel: project.confidentialityLevel,
      contributionCount: project._count.contributions,
    }));

    return { data, total: data.length };
  }

  /**
   * Get paginated approved contributions for a specific project.
   * Ordered by most recently created first.
   */
  async getContributions(
    projectId: string,
    query: VaultContributionQueryDto,
  ): Promise<VaultContributionsResponseDto> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 10;
    const skip = (page - 1) * limit;

    // Verify project exists
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { id: true },
    });

    if (!project) {
      throw new NotFoundException('Project not found');
    }

    const where = {
      projectId,
      status: ContributionStatus.APPROVED,
    };

    const [contributions, total] = await Promise.all([
      this.prisma.contribution.findMany({
        where,
        select: {
          id: true,
          problem: true,
          solution: true,
          outcome: true,
          learnings: true,
          toolsAndTechnologies: true,
          visibility: true,
          createdAt: true,
          updatedAt: true,
          author: {
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
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.contribution.count({ where }),
    ]);

    const totalPages = Math.ceil(total / limit);

    return {
      data: contributions,
      total,
      page,
      limit,
      totalPages,
      hasNextPage: page < totalPages,
      hasPreviousPage: page > 1,
    };
  }
}
