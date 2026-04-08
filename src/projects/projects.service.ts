import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
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
  CreateMilestoneDto,
  UpdateMilestoneDto,
  MilestoneResponseDto,
  CreateSprintDto,
  UpdateSprintDto,
  SprintResponseDto,
  ProjectHubResponseDto,
  ProjectUsersQueryDto,
  RoleCountDto,
} from './dto';
import { ClientSignOff, ConfidentialityLevel, Prisma } from '@prisma/client';
import { ProjectCreatedEvent, ProjectUpdatedEvent, ProjectDeletedEvent } from './events';

@Injectable()
export class ProjectsService {
  private readonly logger = new Logger(ProjectsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  /**
   * Full project settings / delete: project managers, or users with `user` entity.
   * Always verifies the project exists.
   */
  private assertHasPermission(hasPermission: boolean, message: string): void {
    if (!hasPermission) {
      throw new ForbiddenException(message);
    }
  }

  private async assertProjectExists(projectId: string): Promise<void> {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { id: true },
    });
    if (!project) {
      throw new NotFoundException(`Project with ID ${projectId} not found`);
    }
  }

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
        createdById: adminId,
        projectManagers: { create: { userId: adminId } },
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

    return this.findOne(project.id);
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
    bookmarked?: boolean;
    userId?: string;
    actions?: string[];
    sortBy?: 'createdAt' | 'startDate' | 'endDate' | 'activity';
    pinBookmarks?: boolean;
    unassigned?: boolean;
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
    const where: Prisma.ProjectWhereInput = {};

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

    // Users without 'read_all' action see only their assigned projects
    if (query?.userId && !query?.actions?.includes('read_all')) {
      const visibilityCondition: Prisma.ProjectWhereInput = {
        OR: [
          { createdById: query.userId },
          { projectManagers: { some: { userId: query.userId } } },
          { projectLeads: { some: { userId: query.userId } } },
          { userProjects: { some: { userId: query.userId } } },
        ],
      };
      where.AND = where.AND
        ? [...(Array.isArray(where.AND) ? where.AND : [where.AND]), visibilityCondition]
        : [visibilityCondition];
    }

    // Bookmark filter
    if (query?.bookmarked && query?.userId) {
      where.bookmarks = { some: { userId: query.userId } };
    }

    // Unassigned filter: projects with no project managers (admin-only feature)
    if (query?.unassigned) {
      where.projectManagers = { none: {} };
    }

    // Determine orderBy — activity sort is handled in-memory after fetching worklog dates
    const sortBy = query?.sortBy ?? 'createdAt';
    const dbOrderBy: Prisma.ProjectOrderByWithRelationInput =
      sortBy === 'startDate'
        ? { startDate: 'desc' }
        : sortBy === 'endDate'
          ? { endDate: 'desc' }
          : { createdAt: 'desc' };

    // Get total count and data with user assignment counts (excluding system users)
    const [total, data] = await Promise.all([
      this.prisma.project.count({ where }),
      this.prisma.project.findMany({
        where,
        skip,
        take: limit,
        orderBy: dbOrderBy,
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
          status: true,
          createdAt: true,
          updatedAt: true,
          createdBy: { select: { name: true } },
          projectManagers: { select: { userId: true, user: { select: { name: true } } } },
          projectLeads: {
            select: { userId: true, user: { select: { name: true } } },
          },
          userProjects: {
            select: { userId: true },
            where: { user: { isSystem: false } },
          },
          ...(query?.userId
            ? { bookmarks: { where: { userId: query.userId }, select: { id: true } } }
            : {}),
        },
      }),
    ]);

    const projectIds = data.map((p) => p.id);

    // Fetch last worklog date per project for activity sort
    const lastActivityByProject = new Map<string, Date | null>();
    if (sortBy === 'activity' && projectIds.length > 0) {
      const latestWorklogs = await this.prisma.worklog.groupBy({
        by: ['projectId'],
        where: { projectId: { in: projectIds } },
        _max: { date: true },
        orderBy: { projectId: 'asc' },
      });
      for (const row of latestWorklogs) {
        lastActivityByProject.set(row.projectId, row._max.date ?? null);
      }
    }

    type MilestoneMetricsRow = {
      id: string;
      projectId: string;
      status: string;
    };
    type SprintMetricsRow = {
      milestoneId: string;
      status: string;
    };

    const [milestones, sprints] =
      projectIds.length > 0
        ? await Promise.all([
            this.prisma.milestone.findMany({
              where: { projectId: { in: projectIds } },
              select: { id: true, projectId: true, status: true },
            }) as Promise<MilestoneMetricsRow[]>,
            this.prisma.sprint.findMany({
              where: { milestone: { projectId: { in: projectIds } } },
              select: { milestoneId: true, status: true },
            }) as Promise<SprintMetricsRow[]>,
          ])
        : [[], []];

    const milestoneById = new Map<string, { projectId: string; status: string }>();
    const milestoneCountByProject = new Map<string, number>();
    const activeMilestoneCountByProject = new Map<string, number>();
    const completedMilestoneCountByProject = new Map<string, number>();

    for (const milestone of milestones) {
      milestoneById.set(milestone.id, {
        projectId: milestone.projectId,
        status: milestone.status,
      });

      milestoneCountByProject.set(
        milestone.projectId,
        (milestoneCountByProject.get(milestone.projectId) ?? 0) + 1,
      );

      if (milestone.status !== 'CANCELLED') {
        activeMilestoneCountByProject.set(
          milestone.projectId,
          (activeMilestoneCountByProject.get(milestone.projectId) ?? 0) + 1,
        );
        if (milestone.status === 'COMPLETED') {
          completedMilestoneCountByProject.set(
            milestone.projectId,
            (completedMilestoneCountByProject.get(milestone.projectId) ?? 0) + 1,
          );
        }
      }
    }

    const sprintCountByProject = new Map<string, number>();
    const activeSprintCountByProject = new Map<string, number>();
    const completedSprintCountByProject = new Map<string, number>();

    for (const sprint of sprints) {
      const milestoneMeta = milestoneById.get(sprint.milestoneId);
      if (!milestoneMeta) {
        continue;
      }

      const projectId = milestoneMeta.projectId;
      sprintCountByProject.set(projectId, (sprintCountByProject.get(projectId) ?? 0) + 1);

      // Progress logic aligns with project hub:
      // - Ignore cancelled milestones
      // - Ignore cancelled sprints
      if (milestoneMeta.status === 'CANCELLED' || sprint.status === 'CANCELLED') {
        continue;
      }

      activeSprintCountByProject.set(
        projectId,
        (activeSprintCountByProject.get(projectId) ?? 0) + 1,
      );
      if (sprint.status === 'COMPLETED') {
        completedSprintCountByProject.set(
          projectId,
          (completedSprintCountByProject.get(projectId) ?? 0) + 1,
        );
      }
    }

    const totalPages = Math.ceil(total / limit);

    const mapped = data.map((p) => {
      const isUserPM = query?.userId
        ? p.projectManagers.some((pm) => pm.userId === query.userId)
        : false;
      const isUserLead = query?.userId
        ? p.projectLeads.some((pl) => pl.userId === query.userId)
        : false;

      const milestoneProgressPercent = (() => {
        const activeSprints = activeSprintCountByProject.get(p.id) ?? 0;
        const completedSprints = completedSprintCountByProject.get(p.id) ?? 0;
        if (activeSprints > 0) return Math.round((completedSprints / activeSprints) * 100);
        const activeMilestones = activeMilestoneCountByProject.get(p.id) ?? 0;
        const completedMilestones = completedMilestoneCountByProject.get(p.id) ?? 0;
        if (activeMilestones > 0) return Math.round((completedMilestones / activeMilestones) * 100);
        return 0;
      })();

      const isBookmarked = 'bookmarks' in p ? (p as any).bookmarks.length > 0 : false;
      const lastActivityAt = lastActivityByProject.get(p.id) ?? null;

      return {
        ...p,
        createdByName: (p as any).createdBy?.name ?? null,
        createdBy: undefined,
        projectManagerNames: p.projectManagers.map((pm) => pm.user.name),
        projectLeadNames: p.projectLeads.map((pl) => pl.user.name),
        projectManagers: undefined,
        projectLeads: undefined,
        isBookmarked,
        bookmarks: undefined,
        canEdit: query?.actions?.includes('write') ?? false,
        canAssignUsers: query?.actions?.includes('manage_users') ?? false,
        canEditRoadmap: query?.actions?.includes('manage_roadmap') ?? false,
        assignedUserCount: new Set([
          ...(p as any).userProjects.map((up: { userId: string }) => up.userId),
          ...p.projectLeads.map((pl) => pl.userId),
          ...p.projectManagers.map((pm) => pm.userId),
        ]).size,
        userProjects: undefined,
        milestoneCount: milestoneCountByProject.get(p.id) ?? 0,
        sprintCount: sprintCountByProject.get(p.id) ?? 0,
        milestoneProgressPercent,
        lastActivityAt,
      };
    });

    // Activity sort: most recent worklog date first, zero-log projects last
    if (sortBy === 'activity') {
      mapped.sort((a, b) => {
        const aDate = (a as any).lastActivityAt as Date | null;
        const bDate = (b as any).lastActivityAt as Date | null;
        if (aDate && bDate) return bDate.getTime() - aDate.getTime();
        if (aDate) return -1;
        if (bDate) return 1;
        return 0;
      });
    }

    // Pin bookmarked projects to top (within the current page)
    if (query?.pinBookmarks) {
      mapped.sort((a, b) => {
        const aBookmarked = (a as any).isBookmarked ? 0 : 1;
        const bBookmarked = (b as any).isBookmarked ? 0 : 1;
        return aBookmarked - bBookmarked;
      });
    }

    return {
      data: mapped as unknown as ProjectResponseDto[],
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
  async findAllForDropdown(userId?: string): Promise<ProjectDropdownDto[]> {
    const projects = await this.prisma.project.findMany({
      select: {
        id: true,
        name: true,
      },
      orderBy: { name: 'asc' },
    });

    // If no userId provided, return without assigned status
    if (!userId) {
      return projects;
    }

    // Get user's project assignments
    const userAssignments = await this.prisma.userProject.findMany({
      where: { userId },
      select: { projectId: true },
    });

    const assignedProjectIds = new Set(userAssignments.map((up) => up.projectId));

    return projects.map((p) => ({
      ...p,
      assigned: assignedProjectIds.has(p.id),
    }));
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
        status: true,
        executiveSummary: true,
        executiveSummaryUrl: true,
        problemStatement: true,
        problemStatementUrl: true,
        deliverables: true,
        clientContactName: true,
        clientContactEmail: true,
        securityProtocols: true,
        stagingUrl: true,
        liveUrl: true,
        documentationUrl: true,
        figmaUrl: true,
        githubUrl: true,
        projectManagers: { select: { user: { select: { id: true, name: true } } } },
        projectLeads: { select: { userId: true, user: { select: { id: true, name: true } } } },
        userProjects: {
          select: { userId: true },
          where: { user: { isSystem: false } },
        },
        createdBy: { select: { name: true } },
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!project) {
      throw new NotFoundException(`Project with ID ${id} not found`);
    }

    const result = {
      ...project,
      createdByName: (project.createdBy as { name: string } | null)?.name ?? null,
      createdBy: undefined,
      projectManagerNames: project.projectManagers.map((pm) => pm.user.name),
      projectLeadNames: project.projectLeads.map((pl) => pl.user.name),
      projectManagers: undefined,
      projectLeads: undefined,
      assignedUserCount: new Set([
        ...project.userProjects.map((up) => up.userId),
        ...project.projectLeads.map((pl) => pl.userId),
        ...project.projectManagers.map((pm) => pm.user.id),
      ]).size,
      userProjects: undefined,
    } as unknown as ProjectResponseDto;

    return result;
  }

  /**
   * Update a project
   */
  async update(
    id: string,
    updateProjectDto: UpdateProjectDto,
    adminId: string,
    canWrite: boolean,
  ): Promise<ProjectResponseDto> {
    this.assertHasPermission(canWrite, 'You do not have write permission for projects');

    // Check if project exists
    const existingProject = await this.prisma.project.findUnique({
      where: { id },
      include: { projectManagers: { select: { userId: true } } },
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
        // Hub — Narrative
        ...(updateProjectDto.executiveSummary !== undefined && {
          executiveSummary: updateProjectDto.executiveSummary || null,
        }),
        ...(updateProjectDto.executiveSummaryUrl !== undefined && {
          executiveSummaryUrl: updateProjectDto.executiveSummaryUrl ?? null,
        }),
        ...(updateProjectDto.problemStatement !== undefined && {
          problemStatement: updateProjectDto.problemStatement || null,
        }),
        ...(updateProjectDto.problemStatementUrl !== undefined && {
          problemStatementUrl: updateProjectDto.problemStatementUrl ?? null,
        }),
        ...(updateProjectDto.deliverables !== undefined && {
          deliverables: updateProjectDto.deliverables,
        }),
        // Hub — Lifecycle
        ...(updateProjectDto.status !== undefined && { status: updateProjectDto.status }),
        // Hub — Stakeholders handled separately via join tables below
        ...(updateProjectDto.clientContactName !== undefined && {
          clientContactName: updateProjectDto.clientContactName ?? null,
        }),
        ...(updateProjectDto.clientContactEmail !== undefined && {
          clientContactEmail: updateProjectDto.clientContactEmail ?? null,
        }),
        // Hub — Security (Prisma requires JsonNull sentinel for explicit null on Json fields)
        ...(updateProjectDto.securityProtocols !== undefined && {
          securityProtocols: updateProjectDto.securityProtocols
            ? (updateProjectDto.securityProtocols as unknown as Prisma.InputJsonObject)
            : Prisma.JsonNull,
        }),
        // Hub — Resource Links
        ...(updateProjectDto.stagingUrl !== undefined && {
          stagingUrl: updateProjectDto.stagingUrl ?? null,
        }),
        ...(updateProjectDto.liveUrl !== undefined && {
          liveUrl: updateProjectDto.liveUrl ?? null,
        }),
        ...(updateProjectDto.documentationUrl !== undefined && {
          documentationUrl: updateProjectDto.documentationUrl ?? null,
        }),
        ...(updateProjectDto.figmaUrl !== undefined && {
          figmaUrl: updateProjectDto.figmaUrl ?? null,
        }),
        ...(updateProjectDto.githubUrl !== undefined && {
          githubUrl: updateProjectDto.githubUrl ?? null,
        }),
      },
    });

    if (changedFields.length > 0) {
      this.eventEmitter.emit(
        'project.updated',
        new ProjectUpdatedEvent(project.id, project.name, adminId, changedFields),
      );
    }

    // Sync project managers join table
    if (updateProjectDto.projectManagerIds !== undefined) {
      const uniqueIds = [...new Set(updateProjectDto.projectManagerIds)];
      await this.prisma.$transaction([
        this.prisma.projectManager.deleteMany({ where: { projectId: id } }),
        ...(uniqueIds.length > 0
          ? [
              this.prisma.projectManager.createMany({
                data: uniqueIds.map((userId) => ({ projectId: id, userId })),
                skipDuplicates: true,
              }),
            ]
          : []),
      ]);
    }

    // Sync project leads join table
    if (updateProjectDto.projectLeadIds !== undefined) {
      const uniqueIds = [...new Set(updateProjectDto.projectLeadIds)];
      await this.prisma.$transaction([
        this.prisma.projectLead.deleteMany({ where: { projectId: id } }),
        ...(uniqueIds.length > 0
          ? [
              this.prisma.projectLead.createMany({
                data: uniqueIds.map((userId) => ({ projectId: id, userId })),
                skipDuplicates: true,
              }),
            ]
          : []),
      ]);
    }

    return { ...project, assignedUserCount: 0 } as unknown as ProjectResponseDto;
  }

  /**
   * Toggle bookmark for a project.
   */
  async toggleBookmark(projectId: string, userId: string): Promise<{ bookmarked: boolean }> {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { id: true },
    });
    if (!project) {
      throw new NotFoundException(`Project with ID ${projectId} not found`);
    }

    const existing = await this.prisma.projectBookmark.findUnique({
      where: { projectId_userId: { projectId, userId } },
    });

    if (existing) {
      await this.prisma.projectBookmark.delete({ where: { id: existing.id } });
      return { bookmarked: false };
    }

    await this.prisma.projectBookmark.create({ data: { projectId, userId } });
    return { bookmarked: true };
  }

  /**
   * Delete a project
   */
  async remove(id: string, adminId: string, canWrite: boolean): Promise<void> {
    this.assertHasPermission(canWrite, 'You do not have write permission for projects');

    // Check if project exists
    const project = await this.prisma.project.findUnique({
      where: { id },
      include: {
        contributions: { take: 1 },
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
   * Optionally filter by role and include role counts.
   */
  async getProjectUsers(
    projectId: string,
    query?: ProjectUsersQueryDto,
  ): Promise<ProjectUsersResponseDto> {
    // Validate project exists
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { id: true },
    });

    if (!project) {
      throw new NotFoundException(`Project with ID ${projectId} not found`);
    }

    const ELIGIBLE_ENTITIES = ['contribution-review', 'worklog', 'worklog-team'];
    const { roleId, includeRoleCounts } = query ?? {};

    // Build the where clause for user filtering
    const userWhere: Prisma.UserWhereInput = {
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
    };

    // Add role filter: user must have the specified role AND have any role with eligible entities
    if (roleId) {
      userWhere.AND = [
        {
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
        {
          userRoleAssignments: {
            some: { roleId },
          },
        },
      ];
      delete userWhere.userRoleAssignments;
    }

    // Get non-system users who have 'contribution-review', 'worklog', or 'worklog-team' entity access
    // via their assigned role, along with project assignments and PM/lead stakeholder rows
    const [users, assignments, stakeholderProject] = await this.prisma.$transaction([
      this.prisma.user.findMany({
        where: userWhere,
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
                  id: true,
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
      this.prisma.project.findUnique({
        where: { id: projectId },
        select: {
          projectManagers: { select: { userId: true } },
          projectLeads: { select: { userId: true } },
        },
      }),
    ]);

    // Build a map of userId -> assignedAt for quick lookup
    const assignmentMap = new Map<string, Date>();
    for (const a of assignments) {
      assignmentMap.set(a.userId, a.assignedAt);
    }

    const projectManagerUserIds = new Set<string>();
    const projectLeadUserIds = new Set<string>();
    if (stakeholderProject) {
      for (const pm of stakeholderProject.projectManagers) {
        projectManagerUserIds.add(pm.userId);
      }
      for (const pl of stakeholderProject.projectLeads) {
        projectLeadUserIds.add(pl.userId);
      }
    }

    const data: ProjectUserItemDto[] = users.map((user) => {
      const roleIds_ = user.userRoleAssignments.map((ura) => ura.role.id);
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
        isProjectManager: projectManagerUserIds.has(user.id),
        isProjectLead: projectLeadUserIds.has(user.id),
        roleIds: roleIds_,
        roles,
        entityPermissions,
      };
    });

    // Build role counts if requested
    let roleCounts: RoleCountDto[] | undefined;
    let totalEligibleUsers: number | undefined;
    if (includeRoleCounts) {
      // Get all eligible users (without role filter) to calculate counts
      const allEligibleUsers = await this.prisma.user.findMany({
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
          userRoleAssignments: {
            select: {
              role: {
                select: {
                  id: true,
                  displayName: true,
                },
              },
            },
          },
        },
      });

      // Count users per role
      const roleCountMap = new Map<string, { displayName: string; count: number }>();
      for (const user of allEligibleUsers) {
        for (const ura of user.userRoleAssignments) {
          const existing = roleCountMap.get(ura.role.id);
          if (existing) {
            existing.count++;
          } else {
            roleCountMap.set(ura.role.id, {
              displayName: ura.role.displayName,
              count: 1,
            });
          }
        }
      }

      roleCounts = Array.from(roleCountMap.entries()).map(([id, data]) => ({
        id,
        displayName: data.displayName,
        count: data.count,
      }));

      totalEligibleUsers = allEligibleUsers.length;
    }

    return {
      data,
      total: data.length,
      totalEligibleUsers,
      roleCounts,
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
    canManageUsers: boolean,
  ): Promise<{ message: string; assignedUsers: number }> {
    this.assertHasPermission(canManageUsers, 'You do not have permission to manage project users');
    await this.assertProjectExists(projectId);

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

  // ===========================================================================
  // Project Hub
  // ===========================================================================

  private computeMilestoneProgress(
    sprints: { status: string }[],
    milestoneStatus?: string,
  ): number {
    // No sprints: a COMPLETED milestone counts as 100%; otherwise 0%
    if (sprints.length === 0) return milestoneStatus === 'COMPLETED' ? 100 : 0;
    // Cancelled sprints are excluded from both numerator and denominator
    const activeSprints = sprints.filter((s) => s.status !== 'CANCELLED');
    if (activeSprints.length === 0) return milestoneStatus === 'COMPLETED' ? 100 : 0;
    const completed = activeSprints.filter((s) => s.status === 'COMPLETED').length;
    return Math.round((completed / activeSprints.length) * 100);
  }

  /**
   * Get full project hub data — narrative, stakeholders, security, links, roadmap, team.
   */
  async getProjectHub(
    id: string,
    userId: string,
    actions: string[],
  ): Promise<ProjectHubResponseDto> {
    const project = await this.prisma.project.findUnique({
      where: { id },
      include: {
        projectManagers: {
          select: { user: { select: { id: true, name: true, email: true, avatarUrl: true } } },
        },
        projectLeads: {
          select: { user: { select: { id: true, name: true, email: true, avatarUrl: true } } },
        },
        milestones: {
          include: { sprints: { orderBy: { order: 'asc' } } },
          orderBy: { order: 'asc' },
        },
        userProjects: {
          where: { user: { isSystem: false } },
          include: {
            user: {
              select: {
                id: true,
                name: true,
                email: true,
                avatarUrl: true,
                userRoleAssignments: {
                  where: { isPrimary: true },
                  select: { role: { select: { displayName: true } } },
                },
              },
            },
          },
          orderBy: { assignedAt: 'asc' },
        },
      },
    });

    if (!project) {
      throw new NotFoundException(`Project with ID ${id} not found`);
    }

    const canEdit = actions.includes('write');
    const canAssignUsers = actions.includes('manage_users');
    const canEditRoadmap = actions.includes('manage_roadmap');

    // Compute per-milestone progress
    const milestones: MilestoneResponseDto[] = project.milestones.map((m) => ({
      ...m,
      progressPercent: this.computeMilestoneProgress(m.sprints, m.status),
      sprints: m.sprints as SprintResponseDto[],
    }));

    // Compute overall project progress
    // Strategy:
    //   1. Exclude CANCELLED milestones — abandoned work shouldn't dilute progress.
    //   2. If active milestones have sprints, use sprint completion ratio across
    //      all active, non-cancelled sprints (reflects real work done).
    //   3. If no sprints exist at all, fall back to completed-milestone ratio.
    const activeMilestones = milestones.filter((m) => m.status !== 'CANCELLED');
    const completedMilestones = activeMilestones.filter((m) => m.status === 'COMPLETED').length;

    const activeSprints = activeMilestones.flatMap((m) =>
      m.sprints.filter((s) => s.status !== 'CANCELLED'),
    );
    const completedSprints = activeSprints.filter((s) => s.status === 'COMPLETED').length;

    const milestoneProgressPercent =
      activeSprints.length > 0
        ? Math.round((completedSprints / activeSprints.length) * 100)
        : activeMilestones.length > 0
          ? Math.round((completedMilestones / activeMilestones.length) * 100)
          : 0;

    // Build team members list
    const teamMembers = project.userProjects.map((up) => ({
      id: up.user.id,
      name: up.user.name,
      email: up.user.email,
      avatarUrl: up.user.avatarUrl ?? null,
      roles: up.user.userRoleAssignments.map((ura) => ura.role.displayName),
      assignedAt: up.assignedAt,
    }));

    return {
      id: project.id,
      name: project.name,
      clientName: project.clientName,
      domain: project.domain ?? '',
      description: project.description ?? '',
      startDate: project.startDate,
      endDate: project.endDate ?? null,
      techStack: project.techStack,
      confidentialityLevel: project.confidentialityLevel,
      channelUrl: project.channelUrl ?? null,
      executiveSummary: project.executiveSummary ?? null,
      executiveSummaryUrl: project.executiveSummaryUrl ?? null,
      problemStatement: project.problemStatement ?? null,
      problemStatementUrl: project.problemStatementUrl ?? null,
      deliverables: project.deliverables,
      status: project.status,
      projectManagers: project.projectManagers.map((pm) => ({
        id: pm.user.id,
        name: pm.user.name,
        email: pm.user.email,
        avatarUrl: pm.user.avatarUrl ?? null,
      })),
      projectLeads: project.projectLeads.map((pl) => ({
        id: pl.user.id,
        name: pl.user.name,
        email: pl.user.email,
        avatarUrl: pl.user.avatarUrl ?? null,
      })),
      clientContactName: project.clientContactName ?? null,
      clientContactEmail: project.clientContactEmail ?? null,
      securityProtocols: project.securityProtocols as Record<string, unknown> | null,
      stagingUrl: project.stagingUrl ?? null,
      liveUrl: project.liveUrl ?? null,
      documentationUrl: project.documentationUrl ?? null,
      figmaUrl: project.figmaUrl ?? null,
      githubUrl: project.githubUrl ?? null,
      milestones,
      milestoneProgressPercent,
      teamMembers,
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
      canEdit,
      canAssignUsers,
      canEditRoadmap,
    };
  }

  // ===========================================================================
  // Milestones
  // ===========================================================================

  private async validateProjectExists(projectId: string) {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { id: true, startDate: true, endDate: true },
    });
    if (!project) throw new NotFoundException(`Project with ID ${projectId} not found`);
    return project;
  }

  private async validateMilestoneOwnership(milestoneId: string, projectId: string) {
    const milestone = await this.prisma.milestone.findUnique({ where: { id: milestoneId } });
    if (!milestone || milestone.projectId !== projectId) {
      throw new NotFoundException(`Milestone with ID ${milestoneId} not found in this project`);
    }
    return milestone;
  }

  async createMilestone(
    projectId: string,
    dto: CreateMilestoneDto,
    adminId: string,
    canManageRoadmap: boolean,
  ): Promise<MilestoneResponseDto> {
    this.assertHasPermission(canManageRoadmap, 'You do not have permission to manage roadmap');
    await this.validateProjectExists(projectId);

    if (dto.endDate && dto.startDate) {
      if (new Date(dto.endDate) < new Date(dto.startDate)) {
        throw new BadRequestException('Milestone end date must be after start date');
      }
    }

    // Auto-assign order if not provided
    let order = dto.order;
    if (order === undefined) {
      const last = await this.prisma.milestone.findFirst({
        where: { projectId },
        orderBy: { order: 'desc' },
        select: { order: true },
      });
      order = (last?.order ?? -1) + 1;
    }

    const milestone = await this.prisma.milestone.create({
      data: {
        projectId,
        name: dto.name,
        description: dto.description ?? null,
        startDate: new Date(dto.startDate),
        endDate: dto.endDate ? new Date(dto.endDate) : null,
        status: dto.status ?? 'PLANNED',
        clientSignOff: dto.clientSignOff ?? 'PENDING',
        deliverables: dto.deliverables ?? [],
        order,
      },
      include: { sprints: true },
    });

    this.eventEmitter.emit(
      'project.updated',
      new ProjectUpdatedEvent(projectId, '', adminId, ['milestones']),
    );

    return { ...milestone, progressPercent: 0 };
  }

  async updateMilestone(
    projectId: string,
    milestoneId: string,
    dto: UpdateMilestoneDto,
    adminId: string,
    canManageRoadmap: boolean,
  ): Promise<MilestoneResponseDto> {
    this.assertHasPermission(canManageRoadmap, 'You do not have permission to manage roadmap');
    await this.validateProjectExists(projectId);
    const existing = await this.validateMilestoneOwnership(milestoneId, projectId);

    if (dto.endDate && dto.startDate) {
      if (new Date(dto.endDate) < new Date(dto.startDate)) {
        throw new BadRequestException('Milestone end date must be after start date');
      }
    }

    // clientSignOff YES/NO only allowed when status is COMPLETED
    const newStatus = dto.status ?? existing.status;
    const newSignOff = dto.clientSignOff;
    if (newSignOff && newSignOff !== ClientSignOff.PENDING && newStatus !== 'COMPLETED') {
      throw new BadRequestException(
        'Client sign-off can only be set to YES or NO after the milestone is COMPLETED',
      );
    }

    // Cannot mark COMPLETED while sprints are still active or planned
    if (newStatus === 'COMPLETED' && existing.status !== 'COMPLETED') {
      const blockingCount = await this.prisma.sprint.count({
        where: { milestoneId, status: { in: ['PLANNED', 'ACTIVE'] } },
      });
      if (blockingCount > 0) {
        throw new BadRequestException(
          `Cannot complete this milestone: ${blockingCount} sprint(s) are still Planned or Active. Complete or cancel all sprints first.`,
        );
      }
    }

    // Cannot cancel while any sprint is ACTIVE (work in progress)
    if (newStatus === 'CANCELLED' && existing.status !== 'CANCELLED') {
      const activeCount = await this.prisma.sprint.count({
        where: { milestoneId, status: 'ACTIVE' },
      });
      if (activeCount > 0) {
        throw new BadRequestException(
          `Cannot cancel this milestone: ${activeCount} sprint(s) are still Active. Complete or cancel active sprints first.`,
        );
      }
      // Auto-cascade all PLANNED sprints to CANCELLED — they haven't started yet
      await this.prisma.sprint.updateMany({
        where: { milestoneId, status: 'PLANNED' },
        data: { status: 'CANCELLED' },
      });
    }

    const milestone = await this.prisma.milestone.update({
      where: { id: milestoneId },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.description !== undefined && { description: dto.description ?? null }),
        ...(dto.startDate !== undefined && { startDate: new Date(dto.startDate) }),
        ...(dto.endDate !== undefined && { endDate: dto.endDate ? new Date(dto.endDate) : null }),
        ...(dto.status !== undefined && { status: dto.status }),
        ...(dto.clientSignOff !== undefined && { clientSignOff: dto.clientSignOff }),
        ...(dto.deliverables !== undefined && { deliverables: dto.deliverables }),
        ...(dto.order !== undefined && { order: dto.order }),
      },
      include: { sprints: { orderBy: { order: 'asc' } } },
    });

    this.eventEmitter.emit(
      'project.updated',
      new ProjectUpdatedEvent(projectId, '', adminId, ['milestones']),
    );

    return {
      ...milestone,
      progressPercent: this.computeMilestoneProgress(milestone.sprints, milestone.status),
    };
  }

  async deleteMilestone(
    projectId: string,
    milestoneId: string,
    adminId: string,
    canManageRoadmap: boolean,
  ): Promise<void> {
    this.assertHasPermission(canManageRoadmap, 'You do not have permission to manage roadmap');
    await this.validateProjectExists(projectId);
    await this.validateMilestoneOwnership(milestoneId, projectId);

    await this.prisma.milestone.delete({ where: { id: milestoneId } });

    this.eventEmitter.emit(
      'project.updated',
      new ProjectUpdatedEvent(projectId, '', adminId, ['milestones']),
    );
  }

  // ===========================================================================
  // Sprints
  // ===========================================================================

  private async validateSprintOwnership(sprintId: string, milestoneId: string) {
    const sprint = await this.prisma.sprint.findUnique({ where: { id: sprintId } });
    if (!sprint || sprint.milestoneId !== milestoneId) {
      throw new NotFoundException(`Sprint with ID ${sprintId} not found in this milestone`);
    }
    return sprint;
  }

  async createSprint(
    projectId: string,
    milestoneId: string,
    dto: CreateSprintDto,
    adminId: string,
    canManageRoadmap: boolean,
  ): Promise<SprintResponseDto> {
    this.assertHasPermission(canManageRoadmap, 'You do not have permission to manage roadmap');
    await this.validateProjectExists(projectId);
    const existingMilestone = await this.validateMilestoneOwnership(milestoneId, projectId);

    if (dto.endDate && dto.startDate) {
      if (new Date(dto.endDate) < new Date(dto.startDate)) {
        throw new BadRequestException('Sprint end date must be after start date');
      }
    }

    let order = dto.order;
    if (order === undefined) {
      const last = await this.prisma.sprint.findFirst({
        where: { milestoneId },
        orderBy: { order: 'desc' },
        select: { order: true },
      });
      order = (last?.order ?? -1) + 1;
    }

    // Adding a sprint to a COMPLETED milestone invalidates its completion —
    // revert to IN_PROGRESS and clear client sign-off
    const newSprintStatus = dto.status ?? 'PLANNED';
    const sprintIsIncomplete = newSprintStatus !== 'COMPLETED' && newSprintStatus !== 'CANCELLED';
    if (existingMilestone.status === 'COMPLETED' && sprintIsIncomplete) {
      await this.prisma.milestone.update({
        where: { id: milestoneId },
        data: { status: 'IN_PROGRESS', clientSignOff: 'PENDING' },
      });
    }

    const sprint = await this.prisma.sprint.create({
      data: {
        milestoneId,
        name: dto.name,
        description: dto.description ?? null,
        startDate: new Date(dto.startDate),
        endDate: dto.endDate ? new Date(dto.endDate) : null,
        status: newSprintStatus,
        deliverables: dto.deliverables ?? [],
        order,
      },
    });

    this.eventEmitter.emit(
      'project.updated',
      new ProjectUpdatedEvent(projectId, '', adminId, ['sprints']),
    );

    return sprint;
  }

  async updateSprint(
    projectId: string,
    milestoneId: string,
    sprintId: string,
    dto: UpdateSprintDto,
    adminId: string,
    canManageRoadmap: boolean,
  ): Promise<SprintResponseDto> {
    this.assertHasPermission(canManageRoadmap, 'You do not have permission to manage roadmap');
    await this.validateProjectExists(projectId);
    const existingMilestone = await this.validateMilestoneOwnership(milestoneId, projectId);
    const existingSprint = await this.validateSprintOwnership(sprintId, milestoneId);

    if (dto.endDate && dto.startDate) {
      if (new Date(dto.endDate) < new Date(dto.startDate)) {
        throw new BadRequestException('Sprint end date must be after start date');
      }
    }

    // If the sprint is being reopened (moved back to PLANNED or ACTIVE) on a
    // COMPLETED milestone, the milestone can no longer be considered done
    const newSprintStatus = dto.status ?? existingSprint.status;
    if (
      existingMilestone.status === 'COMPLETED' &&
      (newSprintStatus === 'PLANNED' || newSprintStatus === 'ACTIVE')
    ) {
      await this.prisma.milestone.update({
        where: { id: milestoneId },
        data: { status: 'IN_PROGRESS', clientSignOff: 'PENDING' },
      });
    }

    const sprint = await this.prisma.sprint.update({
      where: { id: sprintId },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.description !== undefined && { description: dto.description ?? null }),
        ...(dto.startDate !== undefined && { startDate: new Date(dto.startDate) }),
        ...(dto.endDate !== undefined && { endDate: dto.endDate ? new Date(dto.endDate) : null }),
        ...(dto.status !== undefined && { status: dto.status }),
        ...(dto.deliverables !== undefined && { deliverables: dto.deliverables }),
        ...(dto.order !== undefined && { order: dto.order }),
      },
    });

    this.eventEmitter.emit(
      'project.updated',
      new ProjectUpdatedEvent(projectId, '', adminId, ['sprints']),
    );

    return sprint;
  }

  async deleteSprint(
    projectId: string,
    milestoneId: string,
    sprintId: string,
    adminId: string,
    canManageRoadmap: boolean,
  ): Promise<void> {
    this.assertHasPermission(canManageRoadmap, 'You do not have permission to manage roadmap');
    await this.validateProjectExists(projectId);
    await this.validateMilestoneOwnership(milestoneId, projectId);
    await this.validateSprintOwnership(sprintId, milestoneId);

    await this.prisma.sprint.delete({ where: { id: sprintId } });

    this.eventEmitter.emit(
      'project.updated',
      new ProjectUpdatedEvent(projectId, '', adminId, ['sprints']),
    );
  }
}
