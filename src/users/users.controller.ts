import { Controller, Get, Patch, Param, Query, Body, HttpCode, HttpStatus } from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiParam,
  ApiQuery,
} from '@nestjs/swagger';
import { UsersService } from './users.service';
import { AclService } from '../rbac/rbac.service';
import {
  UserQueryDto,
  ApproveUserDto,
  RejectUserDto,
  ToggleStatusDto,
  UserResponseDto,
  PaginatedUsersResponseDto,
  RoleSelectDto,
} from './dto';
import { RequireEntity, CurrentUser, CuidValidationPipe } from '../common';

@ApiTags('Admin - Users')
@ApiBearerAuth('JWT-auth')
@Controller('admin/users')
export class UsersController {
  constructor(
    private readonly usersService: UsersService,
    private readonly aclService: AclService,
  ) {}

  @Get()
  @RequireEntity('user')
  @ApiOperation({
    summary: 'Get all users with filters and pagination',
    description:
      'Admin endpoint to list all users. Supports filtering by approval status, search, and pagination.',
  })
  @ApiResponse({
    status: 200,
    description: 'List of users',
    type: PaginatedUsersResponseDto,
  })
  async findAll(
    @Query() query: UserQueryDto,
    @CurrentUser() currentUser: { id: string; isSystem: boolean },
  ): Promise<PaginatedUsersResponseDto> {
    return this.usersService.findAll(query, currentUser.isSystem);
  }

  @Get('pending')
  @RequireEntity('user')
  @ApiOperation({
    summary: 'Get pending approval requests',
    description: 'Shorthand endpoint to get only users with PENDING approval status.',
  })
  @ApiResponse({
    status: 200,
    description: 'List of pending approval requests',
    type: PaginatedUsersResponseDto,
  })
  async findPending(
    @Query() query: UserQueryDto,
    @CurrentUser() currentUser: { id: string; isSystem: boolean },
  ): Promise<PaginatedUsersResponseDto> {
    return this.usersService.findPendingRequests(query, currentUser.isSystem);
  }

  @Get('stats')
  @RequireEntity('user')
  @ApiOperation({
    summary: 'Get approval statistics',
    description: 'Get counts of pending, approved, and rejected users.',
  })
  @ApiResponse({
    status: 200,
    description: 'Approval statistics',
    schema: {
      type: 'object',
      properties: {
        pending: { type: 'number' },
        approved: { type: 'number' },
        rejected: { type: 'number' },
        total: { type: 'number' },
      },
    },
  })
  async getStats(): Promise<{
    pending: number;
    approved: number;
    rejected: number;
    total: number;
  }> {
    return this.usersService.getApprovalStats();
  }

  @Get('roles')
  @RequireEntity('user', 'role')
  @ApiOperation({
    summary: 'Get roles list for user assignment',
    description:
      'Get a simplified list of all roles. When userId is provided, includes isAssigned and isPrimary fields for that user.',
  })
  @ApiQuery({
    name: 'userId',
    required: false,
    description:
      'Optional user ID — when provided, each role includes isAssigned and isPrimary flags for that user',
  })
  @ApiResponse({
    status: 200,
    description: 'List of roles',
    type: [RoleSelectDto],
  })
  async getRoles(@Query('userId') userId?: string): Promise<RoleSelectDto[]> {
    return this.aclService.getRolesForSelection(userId);
  }

  @Get(':id')
  @RequireEntity('user')
  @ApiOperation({
    summary: 'Get user by ID',
    description: 'Get detailed information about a specific user.',
  })
  @ApiParam({ name: 'id', description: 'User ID (CUID format)' })
  @ApiResponse({
    status: 200,
    description: 'User details',
    type: UserResponseDto,
  })
  @ApiResponse({ status: 400, description: 'Invalid ID format' })
  @ApiResponse({ status: 404, description: 'User not found' })
  async findOne(@Param('id', CuidValidationPipe) id: string): Promise<UserResponseDto> {
    return this.usersService.findOne(id);
  }

  @Patch(':id/approve')
  @RequireEntity('user')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Approve a user',
    description: 'Approve a pending user and assign them a role.',
  })
  @ApiParam({ name: 'id', description: 'User ID to approve' })
  @ApiResponse({
    status: 200,
    description: 'User approved successfully',
    type: UserResponseDto,
  })
  @ApiResponse({ status: 400, description: 'User already processed' })
  @ApiResponse({ status: 403, description: 'Cannot approve yourself' })
  @ApiResponse({ status: 404, description: 'User not found' })
  async approve(
    @Param('id', CuidValidationPipe) id: string,
    @Body() dto: ApproveUserDto,
    @CurrentUser('id') adminId: string,
  ): Promise<UserResponseDto> {
    return this.usersService.approveUser(id, adminId, dto);
  }

  @Patch(':id/reject')
  @RequireEntity('user')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Reject a user',
    description: 'Reject a pending user with an optional reason.',
  })
  @ApiParam({ name: 'id', description: 'User ID to reject (CUID format)' })
  @ApiResponse({
    status: 200,
    description: 'User rejected successfully',
    type: UserResponseDto,
  })
  @ApiResponse({ status: 400, description: 'Invalid ID format or user already processed' })
  @ApiResponse({ status: 403, description: 'Cannot reject yourself' })
  @ApiResponse({ status: 404, description: 'User not found' })
  async reject(
    @Param('id', CuidValidationPipe) id: string,
    @Body() dto: RejectUserDto,
    @CurrentUser('id') adminId: string,
  ): Promise<UserResponseDto> {
    return this.usersService.rejectUser(id, adminId, dto);
  }

  @Patch(':id/status')
  @RequireEntity('user')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Toggle user access status',
    description:
      'Toggle or set user account access status. When revoking access, all user tokens are invalidated immediately. Admin cannot change their own status.',
  })
  @ApiParam({ name: 'id', description: 'User ID to toggle status' })
  @ApiResponse({
    status: 200,
    description: 'User status updated successfully',
    type: UserResponseDto,
  })
  @ApiResponse({ status: 400, description: 'Cannot change your own status' })
  @ApiResponse({ status: 404, description: 'User not found' })
  async toggleStatus(
    @Param('id', CuidValidationPipe) id: string,
    @Body() dto: ToggleStatusDto,
    @CurrentUser('id') adminId: string,
  ): Promise<UserResponseDto> {
    return this.usersService.toggleUserStatus(id, adminId, dto);
  }
}
