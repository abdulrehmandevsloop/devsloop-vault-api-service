import {
  Controller,
  Get,
  Post,
  Put,
  Patch,
  Delete,
  Param,
  Body,
  Query,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiParam,
  ApiQuery,
} from '@nestjs/swagger';
import { AclService } from './rbac.service';
import {
  CreateRoleDto,
  UpdateRoleDto,
  AssignRoleDto,
  GrantAclDto,
  RoleQueryDto,
  RoleResponseDto,
  PaginatedRoleResponseDto,
} from './dto';
import { Roles, RequireEntity, CurrentUser } from '../common';

@ApiTags('Admin - ACL')
@ApiBearerAuth('JWT-auth')
@Controller('admin/acl')
@Roles('ADMIN')
@RequireEntity('role')
export class AclController {
  constructor(private readonly aclService: AclService) {}

  @Post('roles')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Create a new role',
    description: 'Create a new role with optional entity permissions. Admin only.',
  })
  @ApiResponse({
    status: 201,
    description: 'Role created successfully',
    type: RoleResponseDto,
  })
  @ApiResponse({ status: 400, description: 'Invalid entity IDs' })
  @ApiResponse({ status: 409, description: 'Role name already exists' })
  async createRole(
    @Body() dto: CreateRoleDto,
    @CurrentUser('id') adminId: string,
  ): Promise<RoleResponseDto> {
    return this.aclService.createRole(adminId, dto);
  }

  @Get('roles')
  @ApiOperation({
    summary: 'Get all roles',
    description:
      'Get paginated list of all roles with their entity permissions. Supports sorting and filtering.',
  })
  @ApiResponse({
    status: 200,
    description: 'Paginated list of roles',
    type: PaginatedRoleResponseDto,
  })
  async findAllRoles(@Query() query: RoleQueryDto): Promise<PaginatedRoleResponseDto> {
    return this.aclService.findAllRoles(
      query.page ?? 1,
      query.limit ?? 10,
      query.search,
      query.includeInactive ?? false,
      query.sortBy ?? 'createdAt',
      query.sortOrder ?? 'desc',
    );
  }

  @Get('roles/:id')
  @ApiOperation({
    summary: 'Get role by ID',
    description: 'Get detailed information about a specific role including entity permissions.',
  })
  @ApiParam({ name: 'id', description: 'Role ID' })
  @ApiResponse({
    status: 200,
    description: 'Role details',
    type: RoleResponseDto,
  })
  @ApiResponse({ status: 404, description: 'Role not found' })
  async getRole(@Param('id') id: string): Promise<RoleResponseDto> {
    return this.aclService.getRoleById(id);
  }

  @Patch('roles/:id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Update a role',
    description: 'Update role details and/or entity permissions.',
  })
  @ApiParam({ name: 'id', description: 'Role ID' })
  @ApiResponse({
    status: 200,
    description: 'Role updated successfully',
    type: RoleResponseDto,
  })
  @ApiResponse({ status: 400, description: 'Invalid request or cannot modify system role' })
  @ApiResponse({ status: 404, description: 'Role not found' })
  async updateRole(
    @Param('id') id: string,
    @Body() dto: UpdateRoleDto,
    @CurrentUser('id') adminId: string,
  ): Promise<RoleResponseDto> {
    return this.aclService.updateRole(id, adminId, dto);
  }

  @Delete('roles/:id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Delete a role',
    description:
      'Delete a role. Role must not have any users assigned and cannot be a system role.',
  })
  @ApiParam({ name: 'id', description: 'Role ID' })
  @ApiResponse({
    status: 200,
    description: 'Role deleted successfully',
    schema: {
      type: 'object',
      properties: {
        message: { type: 'string', example: 'Role deleted successfully' },
      },
    },
  })
  @ApiResponse({ status: 400, description: 'Role has users assigned or is a system role' })
  @ApiResponse({ status: 404, description: 'Role not found' })
  async deleteRole(
    @Param('id') id: string,
    @CurrentUser('id') adminId: string,
  ): Promise<{ message: string }> {
    await this.aclService.deleteRole(id, adminId);
    return { message: 'Role deleted successfully' };
  }

  @Post('users/:userId/roles')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Assign role to user',
    description: 'Assign a role to a user.',
  })
  @ApiParam({ name: 'userId', description: 'User ID' })
  @ApiResponse({
    status: 200,
    description: 'Role assigned successfully',
    schema: {
      type: 'object',
      properties: {
        message: { type: 'string', example: 'Role assigned successfully' },
      },
    },
  })
  @ApiResponse({ status: 400, description: 'Role is inactive' })
  @ApiResponse({ status: 404, description: 'User or role not found' })
  @ApiResponse({ status: 409, description: 'User already has this role' })
  async assignRoleToUser(
    @Param('userId') userId: string,
    @Body() dto: AssignRoleDto,
    @CurrentUser('id') adminId: string,
  ): Promise<{ message: string }> {
    await this.aclService.assignRoleToUser(userId, dto, adminId);
    return { message: 'Role assigned successfully' };
  }

  @Delete('users/:userId/roles/:roleId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Remove role from user',
    description: 'Remove a role from a user.',
  })
  @ApiParam({ name: 'userId', description: 'User ID' })
  @ApiParam({ name: 'roleId', description: 'Role ID' })
  @ApiResponse({
    status: 200,
    description: 'Role removed successfully',
    schema: {
      type: 'object',
      properties: {
        message: { type: 'string', example: 'Role removed successfully' },
      },
    },
  })
  @ApiResponse({ status: 404, description: 'User does not have this role' })
  async removeRoleFromUser(
    @Param('userId') userId: string,
    @Param('roleId') roleId: string,
    @CurrentUser('id') adminId: string,
  ): Promise<{ message: string }> {
    await this.aclService.removeRoleFromUser(userId, roleId, adminId);
    return { message: 'Role removed successfully' };
  }

  @Get('entities')
  @ApiOperation({
    summary: 'Get all entities',
    description: 'Get list of all available entities for role assignment.',
  })
  @ApiResponse({
    status: 200,
    description: 'List of entities',
    type: 'array',
  })
  async getAllEntities() {
    return this.aclService.getAllEntities();
  }

  // ============================================
  // DIRECT ACL PERMISSIONS (User-Entity)
  // ============================================

  @Post('users/:userId/permissions')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Grant direct ACL permissions to user',
    description: 'Grant direct entity permissions to a user (bypasses role-based permissions).',
  })
  @ApiParam({ name: 'userId', description: 'User ID' })
  @ApiResponse({
    status: 200,
    description: 'Permissions granted successfully',
    schema: {
      type: 'object',
      properties: {
        message: { type: 'string', example: 'ACL permissions granted successfully' },
      },
    },
  })
  @ApiResponse({ status: 400, description: 'Invalid entity IDs' })
  @ApiResponse({ status: 404, description: 'User not found' })
  async grantAclPermissions(
    @Param('userId') userId: string,
    @Body() dto: GrantAclDto,
    @CurrentUser('id') adminId: string,
  ): Promise<{ message: string }> {
    await this.aclService.grantAclPermissions(userId, dto, adminId);
    return { message: 'ACL permissions granted successfully' };
  }

  @Delete('users/:userId/permissions')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Revoke ACL permissions from user',
    description: 'Revoke direct entity permissions from a user.',
  })
  @ApiParam({ name: 'userId', description: 'User ID' })
  @ApiQuery({
    name: 'entityIds',
    required: true,
    type: String,
    description: 'Comma-separated entity IDs to revoke',
    example: 'entity-id-1,entity-id-2',
  })
  @ApiResponse({
    status: 200,
    description: 'Permissions revoked successfully',
    schema: {
      type: 'object',
      properties: {
        message: { type: 'string', example: 'ACL permissions revoked successfully' },
      },
    },
  })
  @ApiResponse({ status: 404, description: 'User not found' })
  async revokeAclPermissions(
    @Param('userId') userId: string,
    @Query('entityIds') entityIds: string,
    @CurrentUser('id') adminId: string,
  ): Promise<{ message: string }> {
    const entityIdArray = entityIds
      .split(',')
      .map((id) => id.trim())
      .filter(Boolean);
    await this.aclService.revokeAclPermissions(userId, entityIdArray, adminId);
    return { message: 'ACL permissions revoked successfully' };
  }

  @Get('users/:userId/permissions')
  @ApiOperation({
    summary: 'Get user ACL permissions',
    description: 'Get all direct ACL permissions for a user.',
  })
  @ApiParam({ name: 'userId', description: 'User ID' })
  @ApiResponse({
    status: 200,
    description: 'User ACL permissions',
    type: 'array',
  })
  async getUserAclPermissions(@Param('userId') userId: string) {
    return this.aclService.getUserAclPermissions(userId);
  }
}
