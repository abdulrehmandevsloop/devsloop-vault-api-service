import { Controller, Get, Patch, Param, Query, Body, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiParam } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { UsersService } from './users.service';
import {
  UserQueryDto,
  ApproveUserDto,
  RejectUserDto,
  UserResponseDto,
  PaginatedUsersResponseDto,
} from './dto';
import { Roles, CurrentUser } from '../common';

@ApiTags('Admin - Users')
@ApiBearerAuth('JWT-auth')
@Controller('admin/users')
@Roles(UserRole.ADMIN)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
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
  async findAll(@Query() query: UserQueryDto): Promise<PaginatedUsersResponseDto> {
    return this.usersService.findAll(query);
  }

  @Get('pending')
  @ApiOperation({
    summary: 'Get pending approval requests',
    description: 'Shorthand endpoint to get only users with PENDING approval status.',
  })
  @ApiResponse({
    status: 200,
    description: 'List of pending approval requests',
    type: PaginatedUsersResponseDto,
  })
  async findPending(@Query() query: UserQueryDto): Promise<PaginatedUsersResponseDto> {
    return this.usersService.findPendingRequests(query);
  }

  @Get('stats')
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

  @Get(':id')
  @ApiOperation({
    summary: 'Get user by ID',
    description: 'Get detailed information about a specific user.',
  })
  @ApiParam({ name: 'id', description: 'User ID' })
  @ApiResponse({
    status: 200,
    description: 'User details',
    type: UserResponseDto,
  })
  @ApiResponse({ status: 404, description: 'User not found' })
  async findOne(@Param('id') id: string): Promise<UserResponseDto> {
    return this.usersService.findOne(id);
  }

  @Patch(':id/approve')
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
    @Param('id') id: string,
    @Body() dto: ApproveUserDto,
    @CurrentUser('id') adminId: string,
  ): Promise<UserResponseDto> {
    return this.usersService.approveUser(id, adminId, dto);
  }

  @Patch(':id/reject')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Reject a user',
    description: 'Reject a pending user with an optional reason.',
  })
  @ApiParam({ name: 'id', description: 'User ID to reject' })
  @ApiResponse({
    status: 200,
    description: 'User rejected successfully',
    type: UserResponseDto,
  })
  @ApiResponse({ status: 400, description: 'User already processed' })
  @ApiResponse({ status: 403, description: 'Cannot reject yourself' })
  @ApiResponse({ status: 404, description: 'User not found' })
  async reject(
    @Param('id') id: string,
    @Body() dto: RejectUserDto,
    @CurrentUser('id') adminId: string,
  ): Promise<UserResponseDto> {
    return this.usersService.rejectUser(id, adminId, dto);
  }
}
