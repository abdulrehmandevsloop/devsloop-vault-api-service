import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../prisma/prisma.service';
import {
  CreateProjectDto,
  UpdateProjectDto,
  ProjectResponseDto,
  ProjectDropdownDto,
  AssignUsersToProjectDto,
  ProjectUsersResponseDto,
  ProjectUserItemDto,
} from './dto';
import { ConfidentialityLevel } from '@prisma/client';
import { ProjectCreatedEvent, ProjectUpdatedEvent, ProjectDeletedEvent } from './events';

@Injectable()
export class ProjectsService {
  private readonly logger = new Logger(ProjectsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  /**
   * Create a new project
   */
  async create(createProjectDto: CreateProjectDto, adminId: string): Promise<ProjectResponseDto> {
    // Check if project with same name already exists
    const existingProject = await this.prisma.project.findFirst({
      where: {
        name: {
          equals: createProjectDto.name,
          mode: 'insensitive',
        },
      },
    });

    if (existingProject) {
      throw new ConflictException(`Project with name "${createProjectDto.name}" already exists`);
    }

    // Validate dates if end date is provided
    if (createProjectDto.endDate) {
      const startDate = new Date(createProjectDto.startDate);
      const endDate = new Date(createProjectDto.endDate);

      if (endDate < startDate) {
        throw new BadRequestException('End date must be after start date');
      }
    }

    const project = await this.prisma.project.create({
      data: {
        name: createProjectDto.name,
        clientName: createProjectDto.clientName,
        domain: createProjectDto.domain || '',
        description: createProjectDto.description || '',
        startDate: new Date(createProjectDto.startDate),
        endDate: createProjectDto.endDate ? new Date(createProjectDto.endDate) : null,
        techStack: createProjectDto.techStack ?? [],
        confidentialityLevel: createProjectDto.confidentialityLevel ?? 'MEDIUM',
        channelUrl: createProjectDto.channelUrl ?? null,
      },
    });

    this.eventEmitter.emit(
      'project.created',
      new ProjectCreatedEvent(
        project.id,
        project.name,
        adminId,
        createProjectDto.clientName,
        createProjectDto.domain ?? '',
      ),
    );

    return project as ProjectResponseDto;
  }

  /**
   * Get all projects with optional filters
   */
  async findAll(query?: {
    search?: string;
    clientName?: string;
    domain?: string;
    confidentialityLevel?: ConfidentialityLevel;
    page?: number;
    limit?: number;
  }): Promise<{
    data: ProjectResponseDto[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
    hasNextPage: boolean;
    hasPreviousPage: boolean;
  }> {
    const page = query?.page || 1;
    const limit = query?.limit || 10;
    const skip = (page - 1) * limit;

    // Build where clause
    const where: any = {};

    if (query?.search) {
      where.OR = [
        { name: { contains: query.search, mode: 'insensitive' } },
        { clientName: { contains: query.search, mode: 'insensitive' } },
        { domain: { contains: query.search, mode: 'insensitive' } },
        { description: { contains: query.search, mode: 'insensitive' } },
      ];
    }

    if (query?.clientName) {
      where.clientName = { contains: query.clientName, mode: 'insensitive' };
    }

    if (query?.domain) {
      where.domain = { contains: query.domain, mode: 'insensitive' };
    }

    if (query?.confidentialityLevel) {
      where.confidentialityLevel = query.confidentialityLevel;
    }

    // Get total count and data with user assignment counts (excluding system users)
    const [total, data] = await Promise.all([
      this.prisma.project.count({ where }),
      this.prisma.project.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          name: true,
          clientName: true,
          domain: true,
          description: true,
          startDate: true,
          endDate: true,
          techStack: true,
          confidentialityLevel: true,
          channelUrl: true,
          createdAt: true,
          updatedAt: true,
          _count: {
            select: {
              userProjects: {
                where: { user: { isSystem: false } },
              },
            },
          },
        },
      }),
    ]);

    const totalPages = Math.ceil(total / limit);

    return {
      data: data.map((p) => ({
        ...p,
        assignedUserCount: p._count.userProjects,
        _count: undefined,
      })) as ProjectResponseDto[],
      total,
      page,
      limit,
      totalPages,
      hasNextPage: page < totalPages,
      hasPreviousPage: page > 1,
    };
  }

  /**
   * Get all projects for dropdown (id and name only)
   */
  async findAllForDropdown(): Promise<ProjectDropdownDto[]> {
    const projects = await this.prisma.project.findMany({
      select: {
        id: true,
        name: true,
      },
      orderBy: { name: 'asc' },
    });

    return projects;
  }

  /**
   * Get a single project by ID
   */
  async findOne(id: string): Promise<ProjectResponseDto> {
    const project = await this.prisma.project.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        clientName: true,
        domain: true,
        description: true,
        startDate: true,
        endDate: true,
        techStack: true,
        confidentialityLevel: true,
        channelUrl: true,
        createdAt: true,
        updatedAt: true,
        _count: {
          select: {
            userProjects: {
              where: { user: { isSystem: false } },
            },
          },
        },
      },
    });

    if (!project) {
      throw new NotFoundException(`Project with ID ${id} not found`);
    }

    return {
      ...project,
      assignedUserCount: project._count.userProjects,
      _count: undefined,
    } as ProjectResponseDto;
  }

  /**
   * Update a project
   */
  async update(
    id: string,
    updateProjectDto: UpdateProjectDto,
    adminId: string,
  ): Promise<ProjectResponseDto> {
    // Check if project exists
    const existingProject = await this.prisma.project.findUnique({
      where: { id },
    });

    if (!existingProject) {
      throw new NotFoundException(`Project with ID ${id} not found`);
    }

    // Check if name is being changed and if new name already exists
    if (updateProjectDto.name && updateProjectDto.name !== existingProject.name) {
      const nameExists = await this.prisma.project.findFirst({
        where: {
          name: {
            equals: updateProjectDto.name,
            mode: 'insensitive',
          },
          id: { not: id },
        },
      });

      if (nameExists) {
        throw new ConflictException(`Project with name "${updateProjectDto.name}" already exists`);
      }
    }

    // Validate dates if both provided
    const startDate = updateProjectDto.startDate
      ? new Date(updateProjectDto.startDate)
      : existingProject.startDate;
    const endDate = updateProjectDto.endDate
      ? new Date(updateProjectDto.endDate)
      : existingProject.endDate;

    if (startDate && endDate && endDate < startDate) {
      throw new BadRequestException('End date must be after start date');
    }

    // Determine which fields changed
    const changedFields: string[] = [];
    if (updateProjectDto.name !== undefined && updateProjectDto.name !== existingProject.name)
      changedFields.push('name');
    if (
      updateProjectDto.clientName !== undefined &&
      updateProjectDto.clientName !== existingProject.clientName
    )
      changedFields.push('clientName');
    if (updateProjectDto.domain !== undefined && updateProjectDto.domain !== existingProject.domain)
      changedFields.push('domain');
    if (
      updateProjectDto.description !== undefined &&
      updateProjectDto.description !== existingProject.description
    )
      changedFields.push('description');
    if (updateProjectDto.startDate !== undefined) changedFields.push('startDate');
    if (updateProjectDto.endDate !== undefined) changedFields.push('endDate');
    if (updateProjectDto.techStack !== undefined) changedFields.push('techStack');
    if (
      updateProjectDto.confidentialityLevel !== undefined &&
      updateProjectDto.confidentialityLevel !== existingProject.confidentialityLevel
    )
      changedFields.push('confidentialityLevel');

    const project = await this.prisma.project.update({
      where: { id },
      data: {
        name: updateProjectDto.name,
        clientName: updateProjectDto.clientName,
        domain: updateProjectDto.domain,
        description: updateProjectDto.description,
        startDate: updateProjectDto.startDate ? new Date(updateProjectDto.startDate) : undefined,
        endDate: updateProjectDto.endDate ? new Date(updateProjectDto.endDate) : undefined,
        techStack: updateProjectDto.techStack,
        confidentialityLevel: updateProjectDto.confidentialityLevel,
        ...(updateProjectDto.channelUrl !== undefined && {
          channelUrl: updateProjectDto.channelUrl || null,
        }),
      },
    });

    if (changedFields.length > 0) {
      this.eventEmitter.emit(
        'project.updated',
        new ProjectUpdatedEvent(project.id, project.name, adminId, changedFields),
      );
    }

    return project as ProjectResponseDto;
  }

  /**
   * Delete a project
   */
  async remove(id: string, adminId: string): Promise<void> {
    // Check if project exists
    const project = await this.prisma.project.findUnique({
      where: { id },
      include: {
        contributions: {
          take: 1, // Just check if any exist
        },
      },
    });

    if (!project) {
      throw new NotFoundException(`Project with ID ${id} not found`);
    }

    // Check if project has contributions
    if (project.contributions.length > 0) {
      throw new BadRequestException(
        `Cannot delete project with ID ${id}. It has ${project.contributions.length} contribution(s). Delete contributions first.`,
      );
    }

    await this.prisma.project.delete({
      where: { id },
    });

    this.eventEmitter.emit('project.deleted', new ProjectDeletedEvent(id, project.name, adminId));
  }

  /**
   * Get all non-system users with their assignment status for a project.
   */
  async getProjectUsers(projectId: string): Promise<ProjectUsersResponseDto> {
    // Validate project exists
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { id: true },
    });

    if (!project) {
      throw new NotFoundException(`Project with ID ${projectId} not found`);
    }

    const ELIGIBLE_ENTITIES = ['contribution-review', 'worklog', 'worklog-team'];

    // Get non-system users who have 'contribution-review', 'worklog', or 'worklog-team' entity access
    // via their assigned role, along with project assignments
    const [users, assignments] = await this.prisma.$transaction([
      this.prisma.user.findMany({
        where: {
          isSystem: false,
          userRoleAssignments: {
            some: {
              role: {
                roleEntities: {
                  some: { entity: { name: { in: ELIGIBLE_ENTITIES } } },
                },
              },
            },
          },
        },
        select: {
          id: true,
          name: true,
          email: true,
          departments: true,
          avatarUrl: true,
          userRoleAssignments: {
            select: {
              role: {
                select: {
                  displayName: true,
                  roleEntities: {
                    where: { entity: { name: { in: ELIGIBLE_ENTITIES } } },
                    select: { entity: { select: { name: true } } },
                  },
                },
              },
            },
          },
        },
        orderBy: { name: 'asc' },
      }),
      this.prisma.userProject.findMany({
        where: { projectId },
        select: {
          userId: true,
          assignedAt: true,
        },
      }),
    ]);

    // Build a map of userId -> assignedAt for quick lookup
    const assignmentMap = new Map<string, Date>();
    for (const a of assignments) {
      assignmentMap.set(a.userId, a.assignedAt);
    }

    const data: ProjectUserItemDto[] = users.map((user) => {
      const roles = user.userRoleAssignments.map((ura) => ura.role.displayName);
      const entityPermissions = [
        ...new Set(
          user.userRoleAssignments.flatMap((ura) =>
            ura.role.roleEntities.map((re) => re.entity.name),
          ),
        ),
      ];
      return {
        id: user.id,
        name: user.name,
        email: user.email,
        departments: user.departments,
        avatarUrl: user.avatarUrl,
        isAssigned: assignmentMap.has(user.id),
        assignedAt: assignmentMap.get(user.id) ?? null,
        roles,
        entityPermissions,
      };
    });

    return {
      data,
      total: data.length,
    };
  }

  /**
   * Assign/deassign/reassign multiple users to a project.
   * Replaces all existing user assignments for the project.
   * Empty array removes all users from the project.
   */
  async assignUsersToProject(
    projectId: string,
    dto: AssignUsersToProjectDto,
    adminId: string,
  ): Promise<{ message: string; assignedUsers: number }> {
    // Validate project exists
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { id: true },
    });

    if (!project) {
      throw new NotFoundException(`Project with ID ${projectId} not found`);
    }

    const uniqueUserIds = [...new Set(dto.userIds ?? [])];

    // Validate all user IDs exist and are not system users
    if (uniqueUserIds.length > 0) {
      const users = await this.prisma.user.findMany({
        where: { id: { in: uniqueUserIds }, isSystem: false },
        select: { id: true },
      });

      if (users.length !== uniqueUserIds.length) {
        const foundIds = new Set(users.map((u) => u.id));
        const missing = uniqueUserIds.filter((id) => !foundIds.has(id));
        throw new BadRequestException(
          `User(s) not found or are system users: ${missing.join(', ')}`,
        );
      }
    }

    // Replace all assignments in a transaction
    await this.prisma.$transaction(async (tx) => {
      // Delete all existing assignments for this project
      await tx.userProject.deleteMany({ where: { projectId } });

      // Create new assignments
      if (uniqueUserIds.length > 0) {
        await tx.userProject.createMany({
          data: uniqueUserIds.map((userId) => ({
            userId,
            projectId,
            assignedBy: adminId,
          })),
        });
      }
    });

    const message =
      uniqueUserIds.length === 0
        ? 'All user assignments removed from project.'
        : `${uniqueUserIds.length} user(s) assigned to project.`;

    return {
      message,
      assignedUsers: uniqueUserIds.length,
    };
  }
}
