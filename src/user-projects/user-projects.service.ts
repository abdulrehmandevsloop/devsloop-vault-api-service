import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AssignProjectsDto, UserProjectAssignmentDto } from './dto';

@Injectable()
export class UserProjectsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Set user's assigned projects to the given array (add/update in one call).
   * Replaces all existing assignments. Empty array clears all.
   */
  async assignProjects(
    userId: string,
    dto: AssignProjectsDto,
    adminId: string,
  ): Promise<{ message: string; assignedProjects: number }> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });
    if (!user) {
      throw new NotFoundException(`User with ID ${userId} not found`);
    }

    const uniqueProjectIds = [...new Set(dto.projectIds ?? [])];

    if (uniqueProjectIds.length > 0) {
      const projects = await this.prisma.project.findMany({
        where: { id: { in: uniqueProjectIds } },
        select: { id: true },
      });
      if (projects.length !== uniqueProjectIds.length) {
        const foundIds = new Set(projects.map((p) => p.id));
        const missing = uniqueProjectIds.filter((id) => !foundIds.has(id));
        throw new BadRequestException(`Project(s) not found: ${missing.join(', ')}`);
      }
    }

    await this.prisma.$transaction(async (tx) => {
      await (tx as any).userProject.deleteMany({ where: { userId } });
      if (uniqueProjectIds.length > 0) {
        await (tx as any).userProject.createMany({
          data: uniqueProjectIds.map((projectId) => ({
            userId,
            projectId,
            assignedBy: adminId,
          })),
        });
      }
    });

    const message =
      uniqueProjectIds.length === 0
        ? 'All project assignments removed.'
        : `User assigned to ${uniqueProjectIds.length} project(s).`;

    return {
      message,
      assignedProjects: uniqueProjectIds.length,
    };
  }

  /**
   * Remove a project assignment from a user.
   */
  async removeProject(userId: string, projectId: string): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });
    if (!user) {
      throw new NotFoundException(`User with ID ${userId} not found`);
    }

    const assignment = await this.prisma['userProject'].findUnique({
      where: {
        userId_projectId: { userId, projectId },
      },
    });

    if (!assignment) {
      throw new NotFoundException('This user is not assigned to the specified project');
    }

    await this.prisma['userProject'].delete({
      where: {
        userId_projectId: { userId, projectId },
      },
    });
  }

  /**
   * Get all projects assigned to a user.
   */
  async getAssignedProjects(userId: string): Promise<UserProjectAssignmentDto[]> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });
    if (!user) {
      throw new NotFoundException(`User with ID ${userId} not found`);
    }

    const assignments = await this.prisma['userProject'].findMany({
      where: { userId },
      include: {
        project: true,
      },
      orderBy: { assignedAt: 'desc' },
    });

    return assignments.map((a) => ({
      id: a.id,
      assignedAt: a.assignedAt,
      assignedBy: a.assignedBy,
      project: a.project,
    }));
  }
}
