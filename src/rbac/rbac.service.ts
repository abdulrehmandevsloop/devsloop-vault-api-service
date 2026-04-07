import {
  Injectable,
  Logger,
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
  RoleResponseDto,
  PaginatedRoleResponseDto,
  RoleUserItemDto,
  RoleUsersResponseDto,
} from './dto';
import { UserRolesChangedEvent } from '../users/events';

@Injectable()
export class AclService {
  private readonly logger = new Logger(AclService.name);

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

    // Build normalized entity assignments from either `entities` or `entityIds`
    const entityAssignments = this.normalizeEntityAssignments(dto.entities, dto.entityIds);

    // Validate entity IDs if provided
    if (entityAssignments.length > 0) {
      const allEntityIds = entityAssignments.map((e) => e.entityId);
      const entities = await this.prisma.entity.findMany({
        where: { id: { in: allEntityIds }, isActive: true },
      });

      if (entities.length !== allEntityIds.length) {
        const foundIds = entities.map((e) => e.id);
        const missingIds = allEntityIds.filter((id) => !foundIds.includes(id));
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
        },
      });

      // Assign entities if provided
      if (entityAssignments.length > 0) {
        await tx.roleEntity.createMany({
          data: entityAssignments.map((e) => ({
            roleId: newRole.id,
            entityId: e.entityId,
            actions: e.actions ?? [],
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
    _includeInactive: boolean = false,
    sortBy: string = 'createdAt',
    sortOrder: 'asc' | 'desc' = 'desc',
  ): Promise<PaginatedRoleResponseDto> {
    // Ensure page and limit are valid
    const currentPage = Math.max(1, page);
    const pageLimit = Math.max(1, Math.min(100, limit)); // Limit between 1 and 100
    const skip = (currentPage - 1) * pageLimit;

    // Always exclude system roles from the response
    const where: any = { systemRole: false };

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
        select: {
          id: true,
          name: true,
          displayName: true,
          description: true,
          isActive: true,
          systemRole: true,
          createdAt: true,
          updatedAt: true,
          roleEntities: {
            select: {
              actions: true,
              entity: {
                select: {
                  id: true,
                  name: true,
                  displayName: true,
                  description: true,
                  isActive: true,
                },
              },
            },
          },
          _count: {
            select: { userRoleAssignments: true },
          },
        },
      }),
      this.prisma.role.count({ where }),
    ]);

    // Calculate pagination metadata
    const totalPages = Math.ceil(total / pageLimit) || 1;
    const hasNextPage = currentPage < totalPages;
    const hasPreviousPage = currentPage > 1;

    const data: RoleResponseDto[] = roles.map((role) => ({
      id: role.id,
      name: role.name,
      displayName: role.displayName,
      description: role.description,
      isActive: role.isActive,
      systemRole: role.systemRole,
      entities: role.roleEntities.map((re) => ({
        id: re.entity.id,
        name: re.entity.name,
        displayName: re.entity.displayName,
        description: re.entity.description,
        isActive: re.entity.isActive,
        actions: re.actions,
      })),
      userCount: role._count.userRoleAssignments,
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
      select: {
        id: true,
        name: true,
        displayName: true,
        description: true,
        isActive: true,
        systemRole: true,
        createdAt: true,
        updatedAt: true,
        roleEntities: {
          select: {
            actions: true,
            entity: {
              select: {
                id: true,
                name: true,
                displayName: true,
                description: true,
                isActive: true,
              },
            },
          },
        },
        _count: {
          select: { userRoleAssignments: true },
        },
      },
    });

    if (!role) {
      throw new NotFoundException(`Role with ID ${roleId} not found`);
    }

    const roleResponse: RoleResponseDto = {
      id: role.id,
      name: role.name,
      displayName: role.displayName,
      description: role.description,
      isActive: role.isActive,
      systemRole: role.systemRole,
      entities: role.roleEntities.map((re) => ({
        id: re.entity.id,
        name: re.entity.name,
        displayName: re.entity.displayName,
        description: re.entity.description,
        isActive: re.entity.isActive,
        actions: re.actions,
      })),
      userCount: role._count.userRoleAssignments,
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

    // Determine if entities are being updated
    const hasEntityUpdate = dto.entities !== undefined || dto.entityIds !== undefined;
    const entityAssignments = hasEntityUpdate
      ? this.normalizeEntityAssignments(dto.entities, dto.entityIds)
      : null;

    // Validate entity IDs if provided
    if (entityAssignments && entityAssignments.length > 0) {
      const allEntityIds = entityAssignments.map((e) => e.entityId);
      const entities = await this.prisma.entity.findMany({
        where: { id: { in: allEntityIds }, isActive: true },
      });

      if (entities.length !== allEntityIds.length) {
        const foundIds = entities.map((e) => e.id);
        const missingIds = allEntityIds.filter((id) => !foundIds.includes(id));
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
      if (entityAssignments !== null) {
        // Delete existing role-entity relationships
        await tx.roleEntity.deleteMany({
          where: { roleId },
        });

        // Create new relationships
        if (entityAssignments.length > 0) {
          await tx.roleEntity.createMany({
            data: entityAssignments.map((e) => ({
              roleId,
              entityId: e.entityId,
              actions: e.actions ?? [],
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

    // Invalidate action caches for all users with this role
    if (dto.entityIds !== undefined || dto.entities !== undefined) {
      const usersWithRole = await this.prisma.userRoleAssignment.findMany({
        where: { roleId },
        select: { userId: true },
      });
      await Promise.all(usersWithRole.map((u) => this.invalidateUserActionCaches(u.userId)));
    }

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

    // Check if role has users assigned
    const totalUserCount = await this.prisma.userRoleAssignment.count({ where: { roleId } });
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

    // Fetch current role names for the user
    const currentAssignments = await this.prisma.userRoleAssignment.findMany({
      where: { userId },
      include: { role: { select: { displayName: true } } },
    });
    const currentRoleNames = currentAssignments.map((a) => a.role.displayName);

    // Invalidate user cache
    await this.cacheManager.del(`user:${userId}`);
    await this.cacheManager.del(`acl:user:${userId}:roles`);
    await this.invalidateUserActionCaches(userId);

    // Emit audit event
    this.eventEmitter.emit('acl.role.assigned', {
      userId,
      roleId: dto.roleId,
      adminId,
      timestamp: new Date(),
    });

    // Fetch admin name for email context
    const admin = await this.prisma.user.findUnique({
      where: { id: adminId },
      select: { name: true },
    });

    // Emit role-changed event for email notification
    this.eventEmitter.emit(
      'user.roles-changed',
      new UserRolesChangedEvent(
        userId,
        user.email,
        user.name,
        adminId,
        admin?.name || 'An administrator',
        [role.displayName],
        [],
        currentRoleNames,
      ),
    );
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

    const removedRoleName = assignment.role.displayName;

    // Remove role
    await this.prisma.userRoleAssignment.delete({
      where: {
        userId_roleId: {
          userId,
          roleId,
        },
      },
    });

    // Fetch user details for email
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { email: true, name: true },
    });

    // Fetch remaining role names for the user
    const remainingAssignments = await this.prisma.userRoleAssignment.findMany({
      where: { userId },
      include: { role: { select: { displayName: true } } },
    });
    const currentRoleNames = remainingAssignments.map((a) => a.role.displayName);

    // Invalidate user cache
    await this.cacheManager.del(`user:${userId}`);
    await this.cacheManager.del(`acl:user:${userId}:roles`);
    await this.invalidateUserActionCaches(userId);

    // Emit audit event
    this.eventEmitter.emit('acl.role.removed', {
      userId,
      roleId,
      adminId,
      timestamp: new Date(),
    });

    // Emit role-changed event for email notification
    if (user) {
      const admin = await this.prisma.user.findUnique({
        where: { id: adminId },
        select: { name: true },
      });

      this.eventEmitter.emit(
        'user.roles-changed',
        new UserRolesChangedEvent(
          userId,
          user.email,
          user.name,
          adminId,
          admin?.name || 'An administrator',
          [],
          [removedRoleName],
          currentRoleNames,
        ),
      );
    }
  }

  /**
   * Get all non-system users with their assignment status for a role.
   */
  async getRoleUsers(roleId: string): Promise<RoleUsersResponseDto> {
    // Validate role exists
    const role = await this.prisma.role.findUnique({
      where: { id: roleId },
      select: { id: true },
    });

    if (!role) {
      throw new NotFoundException(`Role with ID ${roleId} not found`);
    }

    // Get all non-system users and role assignments in a transaction
    const [users, assignments] = await this.prisma.$transaction([
      this.prisma.user.findMany({
        where: { isSystem: false },
        select: {
          id: true,
          name: true,
          email: true,
          departments: true,
          avatarUrl: true,
        },
        orderBy: { name: 'asc' },
      }),
      this.prisma.userRoleAssignment.findMany({
        where: { roleId },
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

    const data: RoleUserItemDto[] = users.map((user) => ({
      id: user.id,
      name: user.name,
      email: user.email,
      departments: user.departments,
      avatarUrl: user.avatarUrl,
      isAssigned: assignmentMap.has(user.id),
      assignedAt: assignmentMap.get(user.id) ?? null,
    }));

    return {
      data,
      total: data.length,
    };
  }

  /**
   * Assign/deassign/reassign a role to multiple users.
   * Replaces all UserRoleAssignment rows for this role with the given userIds.
   * Empty array removes all users from the role.
   */
  async assignRoleToUsers(
    roleId: string,
    userIds: string[],
    adminId: string,
  ): Promise<{ message: string; assignedUsers: number }> {
    // Validate role exists and is active
    const role = await this.prisma.role.findUnique({
      where: { id: roleId },
    });

    if (!role) {
      throw new NotFoundException(`Role with ID ${roleId} not found`);
    }

    if (!role.isActive) {
      throw new BadRequestException(`Cannot assign users to inactive role "${role.displayName}"`);
    }

    const uniqueUserIds = [...new Set(userIds)];

    // Validate all user IDs exist and are not system users
    let validatedUsers: { id: string; email: string; name: string }[] = [];
    if (uniqueUserIds.length > 0) {
      validatedUsers = await this.prisma.user.findMany({
        where: { id: { in: uniqueUserIds }, isSystem: false },
        select: { id: true, email: true, name: true },
      });

      if (validatedUsers.length !== uniqueUserIds.length) {
        const foundIds = new Set(validatedUsers.map((u) => u.id));
        const missing = uniqueUserIds.filter((id) => !foundIds.has(id));
        throw new BadRequestException(
          `User(s) not found or are system users: ${missing.join(', ')}`,
        );
      }
    }

    // Get previously assigned users for this role (to determine added/removed)
    const previousAssignments = await this.prisma.userRoleAssignment.findMany({
      where: { roleId },
      select: { userId: true },
    });
    const previousUserIdList: string[] = previousAssignments.map((a) => a.userId);
    const previousUserIdSet = new Set<string>(previousUserIdList);
    const newUserIdSet = new Set<string>(uniqueUserIds);

    // Determine added and removed user IDs
    const addedUserIds = uniqueUserIds.filter((id) => !previousUserIdSet.has(id));
    const removedUserIds = previousUserIdList.filter((id) => !newUserIdSet.has(id));

    // Replace all assignments in a transaction
    await this.prisma.$transaction(async (tx) => {
      await tx.userRoleAssignment.deleteMany({ where: { roleId } });

      if (uniqueUserIds.length > 0) {
        await tx.userRoleAssignment.createMany({
          data: uniqueUserIds.map((userId) => ({
            userId,
            roleId,
            assignedBy: adminId,
          })),
        });
      }
    });

    // Collect all affected user IDs (added + removed)
    const allAffectedUserIds = [...new Set([...addedUserIds, ...removedUserIds])];

    // Invalidate caches for all affected users in parallel
    await Promise.all([
      ...allAffectedUserIds.flatMap((userId) => [
        this.cacheManager.del(`user:${userId}`),
        this.cacheManager.del(`acl:user:${userId}:roles`),
        this.invalidateUserActionCaches(userId),
      ]),
      this.cacheManager.del(`acl:role:${roleId}`),
    ]);

    // Emit audit event
    this.eventEmitter.emit('acl.role.users.updated', {
      roleId,
      userIds: uniqueUserIds,
      adminId,
      timestamp: new Date(),
    });

    // Emit role-changed event for each affected user
    if (allAffectedUserIds.length > 0) {
      // Fetch admin name for email context
      const admin = await this.prisma.user.findUnique({
        where: { id: adminId },
        select: { name: true },
      });
      const adminName = admin?.name || 'An administrator';

      // Fetch details for removed users (not in validatedUsers)
      const removedUsers =
        removedUserIds.length > 0
          ? await this.prisma.user.findMany({
              where: { id: { in: removedUserIds } },
              select: { id: true, email: true, name: true },
            })
          : [];

      const allUsersMap = new Map<string, { email: string; name: string }>();
      for (const u of [...validatedUsers, ...removedUsers]) {
        allUsersMap.set(u.id, { email: u.email, name: u.name });
      }

      // Batch-fetch current roles for ALL affected users (avoids N+1)
      const allCurrentRoleAssignments = await this.prisma.userRoleAssignment.findMany({
        where: { userId: { in: allAffectedUserIds } },
        include: { role: { select: { displayName: true } } },
      });

      const rolesByUserId = new Map<string, string[]>();
      for (const assignment of allCurrentRoleAssignments) {
        const list = rolesByUserId.get(assignment.userId) || [];
        list.push(assignment.role.displayName);
        rolesByUserId.set(assignment.userId, list);
      }

      for (const affectedUserId of allAffectedUserIds) {
        const userInfo = allUsersMap.get(affectedUserId);
        if (!userInfo) continue;

        const currentRoleNames = rolesByUserId.get(affectedUserId) || [];

        const wasAdded = addedUserIds.includes(affectedUserId);
        const wasRemoved = removedUserIds.includes(affectedUserId);

        this.eventEmitter.emit(
          'user.roles-changed',
          new UserRolesChangedEvent(
            affectedUserId,
            userInfo.email,
            userInfo.name,
            adminId,
            adminName,
            wasAdded ? [role.displayName] : [],
            wasRemoved ? [role.displayName] : [],
            currentRoleNames,
          ),
        );
      }
    }

    const message =
      uniqueUserIds.length === 0
        ? `All users removed from role "${role.displayName}".`
        : `${uniqueUserIds.length} user(s) assigned to role "${role.displayName}".`;

    return {
      message,
      assignedUsers: uniqueUserIds.length,
    };
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
   * Get roles list for user selection (id, displayName, isActive, systemRole)
   * Used in Admin - Users section for role assignment dropdowns.
   * System roles are always excluded.
   * When userId is provided, includes isAssigned and isPrimary for that user.
   */
  async getRolesForSelection(userId?: string) {
    const roles = await this.prisma.role.findMany({
      where: { systemRole: false },
      select: {
        id: true,
        displayName: true,
        isActive: true,
        systemRole: true,
      },
      orderBy: { displayName: 'asc' },
    });

    // If no userId, return plain roles list
    if (!userId) {
      return roles;
    }

    // Fetch user's role assignments to enrich with isAssigned/isPrimary
    const assignments = await this.prisma.userRoleAssignment.findMany({
      where: { userId },
      select: { roleId: true, isPrimary: true },
    });

    const assignmentMap = new Map<string, boolean>();
    for (const a of assignments) {
      assignmentMap.set(a.roleId, a.isPrimary);
    }

    return roles.map((role) => ({
      ...role,
      isAssigned: assignmentMap.has(role.id),
      isPrimary: assignmentMap.get(role.id) ?? false,
    }));
  }

  /**
   * Batch check entity access for multiple users in a single DB query.
   * Cache-first: returns cached results immediately; uncached users are resolved
   * with one DB round-trip, then cached individually.
   */
  async batchUserHasEntityAccess(
    userIds: string[],
    entityName: string,
  ): Promise<Map<string, boolean>> {
    if (userIds.length === 0) return new Map();

    // Check cache for all users in parallel
    const cachedValues = await Promise.all(
      userIds.map((id) => this.cacheManager.get<boolean>(`acl:user:${id}:entity:${entityName}`)),
    );

    const result = new Map<string, boolean>();
    const uncachedIds: string[] = [];

    for (let i = 0; i < userIds.length; i++) {
      const cached = cachedValues[i];
      if (cached !== undefined) {
        result.set(userIds[i], cached);
      } else {
        uncachedIds.push(userIds[i]);
      }
    }

    if (uncachedIds.length > 0) {
      // Single DB query for all uncached users
      const assignments = await this.prisma.userRoleAssignment.findMany({
        where: {
          userId: { in: uncachedIds },
          role: { isActive: true },
        },
        select: {
          userId: true,
          role: {
            select: {
              roleEntities: {
                select: {
                  entity: {
                    select: { name: true, isActive: true },
                  },
                },
              },
            },
          },
        },
      });

      // Resolve access per user in memory
      const accessByUser = new Map<string, boolean>();
      for (const assignment of assignments) {
        const hasAccess = assignment.role.roleEntities.some(
          (re) => re.entity.name === entityName && re.entity.isActive,
        );
        if (hasAccess) {
          accessByUser.set(assignment.userId, true);
        } else if (!accessByUser.has(assignment.userId)) {
          accessByUser.set(assignment.userId, false);
        }
      }

      // Cache and populate result for uncached users
      await Promise.all(
        uncachedIds.map((userId) => {
          const hasAccess = accessByUser.get(userId) ?? false;
          result.set(userId, hasAccess);
          return this.cacheManager.set(`acl:user:${userId}:entity:${entityName}`, hasAccess, 60);
        }),
      );
    }

    return result;
  }

  /**
   * Get users who have access to a specific entity
   */
  async getUsersWithEntityAccess(entityName: string): Promise<{ email: string; name: string }[]> {
    // Get all active users with roles that have access to the specified entity
    const usersWithAccess = await this.prisma.userRoleAssignment.findMany({
      where: {
        role: {
          isActive: true,
          roleEntities: {
            some: {
              entity: {
                name: entityName,
                isActive: true,
              },
            },
          },
        },
        user: {
          isSystem: false,
        },
      },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            name: true,
          },
        },
      },
      distinct: ['userId'], // Ensure unique users
    });

    return usersWithAccess.map((assignment) => ({
      email: assignment.user.email,
      name: assignment.user.name,
    }));
  }

  /**
   * Check if user has access to an entity (used by guard)
   * Permissions are resolved exclusively via Role → RoleEntity → Entity
   */
  async userHasEntityAccess(userId: string, entityName: string): Promise<boolean> {
    const cacheKey = `acl:user:${userId}:entity:${entityName}`;

    // Check cache first
    const cached = await this.cacheManager.get<boolean>(cacheKey);
    if (cached !== undefined) {
      return cached;
    }

    // Check role-based permissions via UserRoleAssignment → Role → RoleEntity → Entity
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

    // Check if any assigned role has access to the entity
    const hasAccess = userRoles.some((userRole) =>
      userRole.role.roleEntities.some((re) => re.entity.name === entityName && re.entity.isActive),
    );

    // Cache for 1 minute
    await this.cacheManager.set(cacheKey, hasAccess, 60);

    return hasAccess;
  }

  /**
   * Available actions per entity. Entities not listed here have no action-level control.
   */
  private static readonly ENTITY_ACTIONS: Record<
    string,
    { action: string; displayName: string; description: string }[]
  > = {
    project: [
      { action: 'read', displayName: 'Read', description: 'View assigned projects and details' },
      {
        action: 'read_all',
        displayName: 'Read All',
        description: 'View all projects regardless of assignment',
      },
      { action: 'write', displayName: 'Write', description: 'Edit and delete projects' },
      {
        action: 'manage_users',
        displayName: 'Manage Users',
        description: 'Assign and manage users in projects',
      },
      {
        action: 'manage_roadmap',
        displayName: 'Manage Roadmap',
        description: 'Create, edit, delete milestones and sprints',
      },
    ],
  };

  /**
   * Get all entities with their available actions metadata.
   */
  async getEntityActionsMetadata() {
    const entities = await this.prisma.entity.findMany({
      where: { isActive: true },
      select: { id: true, name: true, displayName: true },
      orderBy: { name: 'asc' },
    });

    return entities.map((entity) => ({
      ...entity,
      availableActions: AclService.ENTITY_ACTIONS[entity.name] ?? [],
    }));
  }

  /**
   * Normalize entity assignments from either `entities` (with actions) or `entityIds` (legacy).
   * When `entities` is provided, it takes precedence. `entityIds` entries get empty actions.
   */
  private normalizeEntityAssignments(
    entities?: { entityId: string; actions?: string[] }[],
    entityIds?: string[],
  ): { entityId: string; actions: string[] }[] {
    if (entities && entities.length > 0) {
      return entities.map((e) => ({
        entityId: e.entityId,
        actions: e.actions ?? [],
      }));
    }
    if (entityIds && entityIds.length > 0) {
      return entityIds.map((entityId) => ({ entityId, actions: [] }));
    }
    return [];
  }

  /**
   * Invalidate all entity action caches for a user.
   */
  private async invalidateUserActionCaches(userId: string): Promise<void> {
    const entities = await this.prisma.entity.findMany({
      where: { isActive: true },
      select: { name: true },
    });
    await Promise.all(
      entities.flatMap((e) => [
        this.cacheManager.del(`acl:user:${userId}:entity:${e.name}`),
        this.cacheManager.del(`acl:user:${userId}:entity:${e.name}:actions`),
      ]),
    );
  }

  /**
   * Get all actions a user has for a specific entity (union across all roles).
   */
  async getUserEntityActions(userId: string, entityName: string): Promise<string[]> {
    const cacheKey = `acl:user:${userId}:entity:${entityName}:actions`;

    const cached = await this.cacheManager.get<string[]>(cacheKey);
    if (cached !== undefined) {
      return cached;
    }

    const roleEntities = await this.prisma.roleEntity.findMany({
      where: {
        entity: { name: entityName, isActive: true },
        role: {
          isActive: true,
          userRoleAssignments: { some: { userId } },
        },
      },
      select: { actions: true },
    });

    const actions = [...new Set(roleEntities.flatMap((re) => re.actions))];
    await this.cacheManager.set(cacheKey, actions, 60);
    return actions;
  }

  /**
   * Check if a user has a specific action on an entity.
   */
  async userHasEntityAction(userId: string, entityName: string, action: string): Promise<boolean> {
    const actions = await this.getUserEntityActions(userId, entityName);
    return actions.includes(action);
  }
}
