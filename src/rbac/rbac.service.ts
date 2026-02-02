import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  Inject,
} from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../prisma';
import {
  CreateRoleDto,
  UpdateRoleDto,
  AssignRoleDto,
  GrantAclDto,
  RoleResponseDto,
  PaginatedRoleResponseDto,
} from './dto';

@Injectable()
export class AclService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly eventEmitter: EventEmitter2,
    @Inject(CACHE_MANAGER) private cacheManager: Cache,
  ) {}

  /**
   * Create a new role with optional entity permissions
   */
  async createRole(adminId: string, dto: CreateRoleDto): Promise<RoleResponseDto> {
    // Check if role name already exists
    const existingRole = await this.prisma.role.findUnique({
      where: { name: dto.name },
    });

    if (existingRole) {
      throw new ConflictException(`Role with name "${dto.name}" already exists`);
    }

    // Validate entity IDs if provided
    if (dto.entityIds && dto.entityIds.length > 0) {
      const entities = await this.prisma.entity.findMany({
        where: {
          id: { in: dto.entityIds },
          isActive: true,
        },
      });

      if (entities.length !== dto.entityIds.length) {
        const foundIds = entities.map((e) => e.id);
        const missingIds = dto.entityIds.filter((id) => !foundIds.includes(id));
        throw new BadRequestException(
          `Invalid entity IDs: ${missingIds.join(', ')}. These entities do not exist or are inactive.`,
        );
      }
    }

    // Create role with entities in a transaction
    const role = await this.prisma.$transaction(async (tx) => {
      // Create the role
      const newRole = await tx.role.create({
        data: {
          name: dto.name,
          displayName: dto.displayName,
          description: dto.description || null,
          isActive: dto.isActive ?? true,
          isSystem: false,
        },
      });

      // Assign entities if provided
      if (dto.entityIds && dto.entityIds.length > 0) {
        await tx.roleEntity.createMany({
          data: dto.entityIds.map((entityId) => ({
            roleId: newRole.id,
            entityId,
          })),
        });
      }

      return newRole;
    });

    // Emit audit event
    this.eventEmitter.emit('acl.role.created', {
      roleId: role.id,
      adminId,
      roleName: dto.name,
      entityIds: dto.entityIds || [],
      timestamp: new Date(),
    });

    // Invalidate cache
    await this.cacheManager.del('acl:roles:all');

    return this.getRoleById(role.id);
  }

  /**
   * Get all roles with pagination
   */
  async findAllRoles(
    page: number = 1,
    limit: number = 10,
    search?: string,
    includeInactive: boolean = false,
    sortBy: string = 'createdAt',
    sortOrder: 'asc' | 'desc' = 'desc',
  ): Promise<PaginatedRoleResponseDto> {
    // Ensure page and limit are valid
    const currentPage = Math.max(1, page);
    const pageLimit = Math.max(1, Math.min(100, limit)); // Limit between 1 and 100
    const skip = (currentPage - 1) * pageLimit;

    const where: any = {};
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { displayName: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
      ];
    }

    // if (!includeInactive) {
    //   where.isActive = true;
    // }

    // Build orderBy object dynamically
    const orderBy: any = {};
    // Validate sortBy field to prevent SQL injection
    const allowedSortFields = ['createdAt', 'updatedAt', 'name', 'displayName'];
    const sortField = allowedSortFields.includes(sortBy) ? sortBy : 'createdAt';
    const sortDirection = sortOrder === 'asc' ? 'asc' : 'desc';
    orderBy[sortField] = sortDirection;

    const [roles, total] = await Promise.all([
      this.prisma.role.findMany({
        where,
        skip,
        take: pageLimit,
        orderBy,
        include: {
          roleEntities: {
            include: {
              entity: true,
            },
          },
          _count: {
            select: {
              userRoleAssignments: true,
              users: true, // Primary role assignments via user.roleId
            },
          },
        },
      }),
      this.prisma.role.count({ where }),
    ]);

    // Calculate pagination metadata
    const totalPages = Math.ceil(total / pageLimit) || 1;
    const hasNextPage = currentPage < totalPages;
    const hasPreviousPage = currentPage > 1;

    // Calculate accurate user count for each role
    // Count users who have this role as primary (users) OR secondary (userRoleAssignments)
    // Deduplicate to avoid counting the same user twice
    const roleIds = roles.map((r) => r.id);
    const userCountsMap = new Map<string, number>();

    // Get all user IDs for each role (primary + secondary) in parallel
    const userCountPromises = roleIds.map(async (roleId) => {
      const [primaryUsers, secondaryUsers] = await Promise.all([
        // Users with this role as primary role (via user.roleId)
        this.prisma.user.findMany({
          where: { roleId },
          select: { id: true },
        }),
        // Users with this role as secondary role (via UserRoleAssignment)
        this.prisma.userRoleAssignment.findMany({
          where: { roleId },
          select: { userId: true },
        }),
      ]);

      // Combine and deduplicate user IDs
      const userIds = new Set<string>();
      primaryUsers.forEach((u) => userIds.add(u.id));
      secondaryUsers.forEach((ura) => userIds.add(ura.userId));

      return { roleId, count: userIds.size };
    });

    const userCounts = await Promise.all(userCountPromises);
    userCounts.forEach(({ roleId, count }) => {
      userCountsMap.set(roleId, count);
    });

    const data: RoleResponseDto[] = roles.map((role) => ({
      id: role.id,
      name: role.name,
      displayName: role.displayName,
      description: role.description,
      isActive: role.isActive,
      isSystem: role.isSystem,
      entities: role.roleEntities.map((re) => ({
        id: re.entity.id,
        name: re.entity.name,
        displayName: re.entity.displayName,
        description: re.entity.description,
        isActive: re.entity.isActive,
      })),
      userCount: userCountsMap.get(role.id) || 0,
      createdAt: role.createdAt,
      updatedAt: role.updatedAt,
    }));

    return {
      data,
      total,
      page: currentPage,
      limit: pageLimit,
      totalPages,
      hasNextPage,
      hasPreviousPage,
    };
  }

  /**
   * Get a role by ID
   */
  async getRoleById(roleId: string): Promise<RoleResponseDto> {
    const cacheKey = `acl:role:${roleId}`;

    // Check cache first
    const cached = await this.cacheManager.get<RoleResponseDto>(cacheKey);
    if (cached) {
      return cached;
    }

    const role = await this.prisma.role.findUnique({
      where: { id: roleId },
      include: {
        roleEntities: {
          include: {
            entity: true,
          },
        },
        _count: {
          select: {
            userRoleAssignments: true,
            users: true, // Primary role assignments via user.roleId
          },
        },
      },
    });

    if (!role) {
      throw new NotFoundException(`Role with ID ${roleId} not found`);
    }

    // Calculate accurate user count (primary + secondary, deduplicated)
    const [primaryUsers, secondaryUsers] = await Promise.all([
      // Users with this role as primary role (via user.roleId)
      this.prisma.user.findMany({
        where: { roleId },
        select: { id: true },
      }),
      // Users with this role as secondary role (via UserRoleAssignment)
      this.prisma.userRoleAssignment.findMany({
        where: { roleId },
        select: { userId: true },
      }),
    ]);

    // Combine and deduplicate user IDs
    const userIds = new Set<string>();
    primaryUsers.forEach((u) => userIds.add(u.id));
    secondaryUsers.forEach((ura) => userIds.add(ura.userId));

    const roleResponse: RoleResponseDto = {
      id: role.id,
      name: role.name,
      displayName: role.displayName,
      description: role.description,
      isActive: role.isActive,
      isSystem: role.isSystem,
      entities: role.roleEntities.map((re) => ({
        id: re.entity.id,
        name: re.entity.name,
        displayName: re.entity.displayName,
        description: re.entity.description,
        isActive: re.entity.isActive,
      })),
      userCount: userIds.size,
      createdAt: role.createdAt,
      updatedAt: role.updatedAt,
    };

    // Cache for 5 minutes
    await this.cacheManager.set(cacheKey, roleResponse, 300);

    return roleResponse;
  }

  /**
   * Update a role
   */
  async updateRole(roleId: string, adminId: string, dto: UpdateRoleDto): Promise<RoleResponseDto> {
    // Check if role exists
    const existingRole = await this.prisma.role.findUnique({
      where: { id: roleId },
    });

    if (!existingRole) {
      throw new NotFoundException(`Role with ID ${roleId} not found`);
    }

    if (existingRole.isSystem) {
      throw new BadRequestException('Cannot modify system roles');
    }

    // Validate entity IDs if provided
    if (dto.entityIds && dto.entityIds.length > 0) {
      const entities = await this.prisma.entity.findMany({
        where: {
          id: { in: dto.entityIds },
          isActive: true,
        },
      });

      if (entities.length !== dto.entityIds.length) {
        const foundIds = entities.map((e) => e.id);
        const missingIds = dto.entityIds.filter((id) => !foundIds.includes(id));
        throw new BadRequestException(
          `Invalid entity IDs: ${missingIds.join(', ')}. These entities do not exist or are inactive.`,
        );
      }
    }

    // Update role and entities in a transaction
    await this.prisma.$transaction(async (tx) => {
      // Update role fields
      const updateData: any = {};
      if (dto.displayName !== undefined) updateData.displayName = dto.displayName;
      if (dto.description !== undefined) updateData.description = dto.description || null;
      if (dto.isActive !== undefined) updateData.isActive = dto.isActive;

      await tx.role.update({
        where: { id: roleId },
        data: updateData,
      });

      // Update entities if provided
      if (dto.entityIds !== undefined) {
        // Delete existing role-entity relationships
        await tx.roleEntity.deleteMany({
          where: { roleId },
        });

        // Create new relationships
        if (dto.entityIds.length > 0) {
          await tx.roleEntity.createMany({
            data: dto.entityIds.map((entityId) => ({
              roleId,
              entityId,
            })),
          });
        }
      }
    });

    // Emit audit event
    this.eventEmitter.emit('acl.role.updated', {
      roleId,
      adminId,
      changes: dto,
      timestamp: new Date(),
    });

    // Invalidate cache
    await this.cacheManager.del(`acl:role:${roleId}`);
    await this.cacheManager.del('acl:roles:all');

    return this.getRoleById(roleId);
  }

  /**
   * Delete a role
   */
  async deleteRole(roleId: string, adminId: string): Promise<void> {
    // Check if role exists
    const role = await this.prisma.role.findUnique({
      where: { id: roleId },
      include: {
        _count: {
          select: { userRoleAssignments: true },
        },
      },
    });

    if (!role) {
      throw new NotFoundException(`Role with ID ${roleId} not found`);
    }

    if (role.isSystem) {
      throw new BadRequestException('Cannot delete system roles');
    }

    // Check if role has users assigned (primary or secondary)
    const [primaryUsers, secondaryUsers] = await Promise.all([
      this.prisma.user.count({ where: { roleId } }),
      this.prisma.userRoleAssignment.count({ where: { roleId } }),
    ]);

    const totalUserCount = primaryUsers + secondaryUsers;
    if (totalUserCount > 0) {
      throw new BadRequestException(
        `Cannot delete role "${role.displayName}" because it has ${totalUserCount} user(s) assigned. Please reassign users first.`,
      );
    }

    // Delete role (roleEntities will be cascade deleted)
    await this.prisma.role.delete({
      where: { id: roleId },
    });

    // Emit audit event
    this.eventEmitter.emit('acl.role.deleted', {
      roleId,
      adminId,
      roleName: role.name,
      timestamp: new Date(),
    });

    // Invalidate cache
    await this.cacheManager.del(`acl:role:${roleId}`);
    await this.cacheManager.del('acl:roles:all');
  }

  /**
   * Assign a role to a user
   */
  async assignRoleToUser(userId: string, dto: AssignRoleDto, adminId: string): Promise<void> {
    // Check if user exists
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new NotFoundException(`User with ID ${userId} not found`);
    }

    // Check if role exists and is active
    const role = await this.prisma.role.findUnique({
      where: { id: dto.roleId },
    });

    if (!role) {
      throw new NotFoundException(`Role with ID ${dto.roleId} not found`);
    }

    if (!role.isActive) {
      throw new BadRequestException(`Cannot assign inactive role "${role.displayName}"`);
    }

    // Check if user already has this role
    const existingAssignment = await this.prisma.userRoleAssignment.findUnique({
      where: {
        userId_roleId: {
          userId,
          roleId: dto.roleId,
        },
      },
    });

    if (existingAssignment) {
      throw new ConflictException(`User already has role "${role.displayName}"`);
    }

    // Assign role
    await this.prisma.userRoleAssignment.create({
      data: {
        userId,
        roleId: dto.roleId,
        assignedBy: adminId,
      },
    });

    // Invalidate user cache
    await this.cacheManager.del(`user:${userId}`);
    await this.cacheManager.del(`acl:user:${userId}:roles`);

    // Emit audit event
    this.eventEmitter.emit('acl.role.assigned', {
      userId,
      roleId: dto.roleId,
      adminId,
      timestamp: new Date(),
    });
  }

  /**
   * Remove a role from a user
   */
  async removeRoleFromUser(userId: string, roleId: string, adminId: string): Promise<void> {
    // Check if assignment exists
    const assignment = await this.prisma.userRoleAssignment.findUnique({
      where: {
        userId_roleId: {
          userId,
          roleId,
        },
      },
      include: {
        role: true,
      },
    });

    if (!assignment) {
      throw new NotFoundException('User does not have this role assigned');
    }

    // Remove role
    await this.prisma.userRoleAssignment.delete({
      where: {
        userId_roleId: {
          userId,
          roleId,
        },
      },
    });

    // Invalidate user cache
    await this.cacheManager.del(`user:${userId}`);
    await this.cacheManager.del(`acl:user:${userId}:roles`);

    // Emit audit event
    this.eventEmitter.emit('acl.role.removed', {
      userId,
      roleId,
      adminId,
      timestamp: new Date(),
    });
  }

  /**
   * Get all entities (for admin UI)
   */
  async getAllEntities() {
    return this.prisma.entity.findMany({
      where: { isActive: true },
      orderBy: { displayName: 'asc' },
    });
  }

  /**
   * Get simplified list of all roles (for admin user management)
   * Returns only: id, name, displayName, isActive
   */
  async getRolesList() {
    const roles = await this.prisma.role.findMany({
      select: {
        id: true,
        name: true,
        displayName: true,
        isActive: true,
      },
      orderBy: { displayName: 'asc' },
    });

    return roles;
  }

  /**
   * Get roles list for user selection (id, displayName, isActive, isSystem)
   * Used in Admin - Users section for role assignment dropdowns
   */
  async getRolesForSelection() {
    const roles = await this.prisma.role.findMany({
      select: {
        id: true,
        displayName: true,
        isActive: true,
        isSystem: true,
      },
      orderBy: { displayName: 'asc' },
    });

    return roles;
  }

  /**
   * Check if user has access to an entity (used by guard)
   * ACL Priority: Direct ACL entries > Role-based permissions
   */
  async userHasEntityAccess(userId: string, entityName: string): Promise<boolean> {
    const cacheKey = `acl:user:${userId}:entity:${entityName}`;

    // Check cache first
    const cached = await this.cacheManager.get<boolean>(cacheKey);
    if (cached !== undefined) {
      return cached;
    }

    // First, check direct ACL entries (highest priority)
    const entity = await this.prisma.entity.findUnique({
      where: { name: entityName },
    });

    if (!entity || !entity.isActive) {
      await this.cacheManager.set(cacheKey, false, 60);
      return false;
    }

    const directAclEntry = await this.prisma.aclEntry.findUnique({
      where: {
        userId_entityId: {
          userId,
          entityId: entity.id,
        },
      },
    });

    // If direct ACL entry exists, user has access
    if (directAclEntry) {
      await this.cacheManager.set(cacheKey, true, 60);
      return true;
    }

    // Fall back to role-based permissions
    // Check both primary role (roleId) and secondary roles (UserRoleAssignment)

    // Get user with primary role
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        roleId: true,
        role: {
          select: {
            isActive: true,
            roleEntities: {
              include: {
                entity: true,
              },
            },
          },
        },
      },
    });

    // Check primary role's entity permissions (if role exists and is active)
    const primaryRoleHasAccess =
      user?.roleId &&
      user?.role?.isActive &&
      user.role.roleEntities.some((re) => re.entity.name === entityName && re.entity.isActive)
        ? true
        : false;

    if (primaryRoleHasAccess) {
      await this.cacheManager.set(cacheKey, true, 60);
      return true;
    }

    // Check secondary roles (UserRoleAssignment)
    const userRoles = await this.prisma.userRoleAssignment.findMany({
      where: {
        userId,
        role: {
          isActive: true,
        },
      },
      include: {
        role: {
          include: {
            roleEntities: {
              include: {
                entity: true,
              },
            },
          },
        },
      },
    });

    // Check if any secondary role has access to the entity
    const secondaryRoleHasAccess = userRoles.some((userRole) =>
      userRole.role.roleEntities.some((re) => re.entity.name === entityName && re.entity.isActive),
    );

    const hasAccess = primaryRoleHasAccess || secondaryRoleHasAccess;

    // Cache for 1 minute (reduced from 5 minutes for better consistency)
    await this.cacheManager.set(cacheKey, hasAccess, 60);

    return hasAccess;
  }

  // ============================================
  // ACL MANAGEMENT (Direct User-Entity Permissions)
  // ============================================

  /**
   * Grant direct ACL permissions to a user
   */
  async grantAclPermissions(userId: string, dto: GrantAclDto, adminId: string): Promise<void> {
    // Check if user exists
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new NotFoundException(`User with ID ${userId} not found`);
    }

    // Validate entity IDs
    const entities = await this.prisma.entity.findMany({
      where: {
        id: { in: dto.entityIds },
        isActive: true,
      },
    });

    if (entities.length !== dto.entityIds.length) {
      const foundIds = entities.map((e) => e.id);
      const missingIds = dto.entityIds.filter((id) => !foundIds.includes(id));
      throw new BadRequestException(
        `Invalid entity IDs: ${missingIds.join(', ')}. These entities do not exist or are inactive.`,
      );
    }

    // Create ACL entries (upsert to handle duplicates)
    await this.prisma.$transaction(
      dto.entityIds.map((entityId) =>
        this.prisma.aclEntry.upsert({
          where: {
            userId_entityId: {
              userId,
              entityId,
            },
          },
          update: {
            grantedBy: adminId,
          },
          create: {
            userId,
            entityId,
            grantedBy: adminId,
          },
        }),
      ),
    );

    // Invalidate cache
    await this.cacheManager.del(`user:${userId}`);
    dto.entityIds.forEach((entityId) => {
      const entity = entities.find((e) => e.id === entityId);
      if (entity) {
        void this.cacheManager.del(`acl:user:${userId}:entity:${entity.name}`);
      }
    });

    // Emit audit event
    this.eventEmitter.emit('acl.permissions.granted', {
      userId,
      entityIds: dto.entityIds,
      adminId,
      timestamp: new Date(),
    });
  }

  /**
   * Revoke ACL permissions from a user
   */
  async revokeAclPermissions(userId: string, entityIds: string[], adminId: string): Promise<void> {
    // Check if user exists
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new NotFoundException(`User with ID ${userId} not found`);
    }

    // Get entities for cache invalidation
    const entities = await this.prisma.entity.findMany({
      where: { id: { in: entityIds } },
    });

    // Delete ACL entries
    await this.prisma.aclEntry.deleteMany({
      where: {
        userId,
        entityId: { in: entityIds },
      },
    });

    // Invalidate cache
    await this.cacheManager.del(`user:${userId}`);
    entities.forEach((entity) => {
      void this.cacheManager.del(`acl:user:${userId}:entity:${entity.name}`);
    });

    // Emit audit event
    this.eventEmitter.emit('acl.permissions.revoked', {
      userId,
      entityIds,
      adminId,
      timestamp: new Date(),
    });
  }

  /**
   * Get user's ACL permissions
   */
  async getUserAclPermissions(userId: string) {
    const aclEntries = await this.prisma.aclEntry.findMany({
      where: { userId },
      include: {
        entity: true,
      },
      orderBy: {
        grantedAt: 'desc',
      },
    });

    return aclEntries.map((entry) => ({
      id: entry.id,
      entity: {
        id: entry.entity.id,
        name: entry.entity.name,
        displayName: entry.entity.displayName,
        description: entry.entity.description,
      },
      grantedAt: entry.grantedAt,
      grantedBy: entry.grantedBy,
    }));
  }
}
