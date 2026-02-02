import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateProjectDto, UpdateProjectDto, ProjectResponseDto, ProjectDropdownDto } from './dto';
import { ConfidentialityLevel } from '@prisma/client';

@Injectable()
export class ProjectsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Create a new project
   */
  async create(createProjectDto: CreateProjectDto): Promise<ProjectResponseDto> {
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
        domain: createProjectDto.domain,
        description: createProjectDto.description,
        startDate: new Date(createProjectDto.startDate),
        endDate: createProjectDto.endDate ? new Date(createProjectDto.endDate) : null,
        techStack: createProjectDto.techStack,
        confidentialityLevel: createProjectDto.confidentialityLevel,
      },
    });

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

    // Get total count and data
    const [total, data] = await Promise.all([
      this.prisma.project.count({ where }),
      this.prisma.project.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    const totalPages = Math.ceil(total / limit);

    return {
      data: data as ProjectResponseDto[],
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
    });

    if (!project) {
      throw new NotFoundException(`Project with ID ${id} not found`);
    }

    return project as ProjectResponseDto;
  }

  /**
   * Update a project
   */
  async update(id: string, updateProjectDto: UpdateProjectDto): Promise<ProjectResponseDto> {
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
      },
    });

    return project as ProjectResponseDto;
  }

  /**
   * Delete a project
   */
  async remove(id: string): Promise<void> {
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
  }
}
