import { Controller, Get, Post, Delete, Param, Body, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiParam } from '@nestjs/swagger';
import { WarningsService } from './warnings.service';
import { CreateWarningDto, WarningResponseDto } from './dto';
import { RequireEntity, CurrentUser, CuidValidationPipe } from '../common';

@ApiTags('Admin - User Warnings')
@ApiBearerAuth('JWT-auth')
@Controller('admin/users/:userId/warnings')
export class WarningsController {
  constructor(private readonly warningsService: WarningsService) {}

  @Get()
  @RequireEntity('user')
  @ApiOperation({
    summary: 'Get warnings for a user',
    description: 'Returns all warnings recorded for the given user (newest first).',
  })
  @ApiParam({ name: 'userId', description: 'User ID (CUID format)' })
  @ApiResponse({ status: 200, description: 'List of warnings', type: [WarningResponseDto] })
  @ApiResponse({ status: 404, description: 'User not found' })
  async getWarnings(
    @Param('userId', CuidValidationPipe) userId: string,
  ): Promise<WarningResponseDto[]> {
    return this.warningsService.findAllForUser(userId);
  }

  @Post()
  @RequireEntity('user')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Create a warning for a user',
    description: 'Record a warning against the user. Cannot issue a warning to yourself.',
  })
  @ApiParam({ name: 'userId', description: 'User ID (CUID format)' })
  @ApiResponse({ status: 201, description: 'Warning created', type: WarningResponseDto })
  @ApiResponse({ status: 400, description: 'Invalid body or attempting to warn yourself' })
  @ApiResponse({ status: 404, description: 'User not found' })
  async createWarning(
    @Param('userId', CuidValidationPipe) userId: string,
    @Body() dto: CreateWarningDto,
    @CurrentUser('id') createdById: string,
  ): Promise<WarningResponseDto> {
    return this.warningsService.create(userId, dto, createdById);
  }

  @Delete(':warningId')
  @RequireEntity('user')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Delete a warning',
    description: 'Remove a warning from the user. Cannot delete a warning belonging to yourself.',
  })
  @ApiParam({ name: 'userId', description: 'User ID (CUID format)' })
  @ApiParam({ name: 'warningId', description: 'Warning ID (CUID format)' })
  @ApiResponse({ status: 204, description: 'Warning deleted' })
  @ApiResponse({ status: 400, description: 'Cannot delete a warning issued to yourself' })
  @ApiResponse({ status: 404, description: 'User or warning not found' })
  async deleteWarning(
    @Param('userId', CuidValidationPipe) userId: string,
    @Param('warningId', CuidValidationPipe) warningId: string,
    @CurrentUser('id') deletingUserId: string,
  ): Promise<void> {
    return this.warningsService.delete(userId, warningId, deletingUserId);
  }
}
