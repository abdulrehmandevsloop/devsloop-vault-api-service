import {
  Controller,
  Post,
  Get,
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
  ApiBody,
} from '@nestjs/swagger';
import { ContributionStatus } from '@prisma/client';
import { ContributionsService } from './contributions.service';
import { ContributionSearchService } from './services';
import {
  CreateContributionDto,
  UpdateContributionDto,
  ApproveContributionDto,
  RejectContributionDto,
  ContributionResponseDto,
  ListContributionsQueryDto,
  PaginatedContributionsResponseDto,
  PendingContributionsQueryDto,
  ReviewerContributionsResponseDto,
  MyContributionsQueryDto,
  MyContributionsResponseDto,
  SearchContributionsQueryDto,
  SearchContributionsResponseDto,
  ContributionHistoryResponseDto,
  CombinedLeaderboardResponseDto,
} from './dto';
import { CurrentUser, RequireEntity, CuidValidationPipe, ResponseService } from '../common';

@ApiTags('Contributions')
@ApiBearerAuth('JWT-auth')
@Controller('contributions')
export class ContributionsController {
  constructor(
    private readonly contributionsService: ContributionsService,
    private readonly contributionSearchService: ContributionSearchService,
    private readonly responseService: ResponseService,
  ) {}

  @Post()
  @RequireEntity('contribution')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Create a new contribution',
    description:
      'Create a new contribution as DRAFT. Requires projectId to associate the contribution with a project. ' +
      'Employee can later submit it for review. ' +
      'The solution, outcome, and learnings fields support rich text (HTML).',
  })
  @ApiBody({
    description: 'Contribution data including projectId (required)',
    type: CreateContributionDto,
  })
  @ApiResponse({
    status: 201,
    description: 'Contribution created successfully',
    type: ContributionResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: 'Validation error (e.g., missing projectId, invalid field lengths)',
  })
  @ApiResponse({ status: 403, description: 'Missing contribution entity access' })
  @ApiResponse({ status: 404, description: 'Project not found' })
  async create(
    @Body() dto: CreateContributionDto,
    @CurrentUser('id') authorId: string,
  ): Promise<ContributionResponseDto> {
    return this.contributionsService.create(authorId, dto);
  }

  @Get()
  @RequireEntity('contribution-review')
  @ApiOperation({
    summary: 'List contributions for reviewer (with filters)',
    description:
      'Returns contributions for projects the current user is assigned to as reviewer. ' +
      'Reviewers are assigned by admin (user–project assignments); roles are dynamic. ' +
      'Filter by project (projectId), status (SUBMITTED = pending, APPROVED = approved, REJECTED = rejected). Paginated.',
  })
  @ApiResponse({
    status: 200,
    description: 'Paginated list of contributions',
    type: PaginatedContributionsResponseDto,
  })
  async findForReviewer(
    @CurrentUser('id') reviewerId: string,
    @Query() query: ListContributionsQueryDto,
  ): Promise<PaginatedContributionsResponseDto> {
    return this.contributionsService.findForReviewer(reviewerId, query);
  }

  @Get('my')
  @RequireEntity('contribution')
  @ApiOperation({
    summary: 'Get my contributions (paginated with status counts and optional status filter)',
    description:
      'Get paginated list of contributions created by the current user with counts for each status (draft, submitted, approved, rejected). ' +
      'Optionally filter by status using the status query parameter.',
  })
  @ApiQuery({
    name: 'page',
    required: false,
    type: Number,
    description: 'Page number (default: 1)',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    type: Number,
    description: 'Items per page (default: 20, max: 100)',
  })
  @ApiQuery({
    name: 'status',
    required: false,
    enum: ContributionStatus,
    description:
      'Filter by status: DRAFT, SUBMITTED (pending), APPROVED, REJECTED. Omit to return all statuses.',
  })
  @ApiResponse({
    status: 200,
    description:
      'Paginated list of user contributions with status counts (filtered by status if provided)',
    type: MyContributionsResponseDto,
  })
  async findMyContributions(
    @CurrentUser('id') authorId: string,
    @Query() query: MyContributionsQueryDto,
  ): Promise<MyContributionsResponseDto> {
    return this.contributionsService.findMyContributions(
      authorId,
      query.page ?? 1,
      query.limit ?? 20,
      query.status,
    );
  }

  @Get('reviewer')
  @RequireEntity('contribution-review')
  @ApiOperation({
    summary: 'Get contributions for assigned reviewer (with project and status filters, paginated)',
    description:
      'Returns paginated contributions for projects the current user is assigned to as reviewer. ' +
      'Filter by project (projectId) and/or status. By default, shows pending (SUBMITTED) only. ' +
      'Reviewers are assigned by admin (user–project assignments); roles are dynamic. ' +
      'Returns paginated contributions along with counts for pending, approved, and rejected contributions.',
  })
  @ApiQuery({
    name: 'projectId',
    required: false,
    description: 'Filter by project ID (must be a project the reviewer is assigned to)',
  })
  @ApiQuery({
    name: 'status',
    required: false,
    enum: ContributionStatus,
    description:
      'Filter by status: SUBMITTED (pending), APPROVED (approved), REJECTED (rejected). Default: SUBMITTED (pending) if omitted.',
  })
  @ApiQuery({
    name: 'page',
    required: false,
    type: Number,
    description: 'Page number (default: 1)',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    type: Number,
    description: 'Items per page (default: 20, max: 100)',
  })
  @ApiResponse({
    status: 200,
    description:
      'Paginated contributions list with counts for pending, approved, and rejected (filtered by project and/or status; default: pending/SUBMITTED)',
    type: ReviewerContributionsResponseDto,
  })
  async findReviewerContributions(
    @CurrentUser('id') reviewerId: string,
    @Query() query: PendingContributionsQueryDto,
  ): Promise<ReviewerContributionsResponseDto> {
    return this.contributionsService.findPendingContributions(
      reviewerId,
      query.projectId,
      query.status,
      query.page ?? 1,
      query.limit ?? 20,
    );
  }

  // ===========================================================================
  // Leaderboard Endpoints
  // ===========================================================================

  @Get('leaderboard')
  @RequireEntity('user')
  @ApiOperation({
    summary: 'Combined leaderboard data',
    description:
      'Returns top contributors, reviewers, and skill experts in a single request. Requires user entity access.',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    type: Number,
    description: 'Number of entries to return per category (default: 10, max: 50)',
  })
  @ApiResponse({
    status: 200,
    description: 'Combined leaderboard data',
    type: CombinedLeaderboardResponseDto,
  })
  async getLeaderboard(@Query('limit') limit?: string): Promise<CombinedLeaderboardResponseDto> {
    const n = Math.min(parseInt(limit ?? '10', 10) || 10, 50);

    const [topContributors, topReviewers, skillExperts] = await Promise.all([
      this.contributionsService.getTopContributors(n),
      this.contributionsService.getTopReviewers(n),
      this.contributionsService.getSkillExperts(n),
    ]);

    return this.responseService.success(
      {
        topContributors,
        topReviewers,
        skillExperts,
      },
      'Leaderboard data retrieved successfully!',
    );
  }

  @Get('user/:userId')
  @RequireEntity('user')
  @ApiOperation({
    summary: 'Get contributions for a specific user (admin view)',
    description:
      'Returns paginated contributions for a given user ID with status counts. ' +
      'Requires "user" entity access (admin-level). Supports optional status filter and pagination.',
  })
  @ApiParam({ name: 'userId', description: 'Target user ID (CUID format)' })
  @ApiQuery({
    name: 'page',
    required: false,
    type: Number,
    description: 'Page number (default: 1)',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    type: Number,
    description: 'Items per page (default: 20, max: 100)',
  })
  @ApiQuery({
    name: 'status',
    required: false,
    enum: ContributionStatus,
    description: 'Filter by status: DRAFT, SUBMITTED, APPROVED, REJECTED. Omit for all.',
  })
  @ApiResponse({
    status: 200,
    description: 'Paginated contributions with status counts',
    type: MyContributionsResponseDto,
  })
  @ApiResponse({ status: 403, description: 'Missing user entity access' })
  async findUserContributions(
    @Param('userId', CuidValidationPipe) userId: string,
    @Query() query: MyContributionsQueryDto,
  ): Promise<MyContributionsResponseDto> {
    return this.contributionsService.findMyContributions(
      userId,
      query.page ?? 1,
      query.limit ?? 20,
      query.status,
    );
  }

  @Get('search')
  @RequireEntity('vault')
  @ApiOperation({
    summary: 'Search approved contributions (full-text search)',
    description:
      'Full-text search across approved contribution content (problem, solution, outcome, learnings, tools). ' +
      'Only contributions with status APPROVED are searchable. ' +
      'Supports phrase search with quotes, exclusion with -, and OR operator. ' +
      'Results are ranked by relevance with highlighted matching snippets. ' +
      'Falls back to typo-tolerant trigram search if no exact results are found.',
  })
  @ApiQuery({
    name: 'q',
    required: true,
    description: 'Search query (2-200 characters)',
    example: 'kubernetes deployment',
  })
  @ApiQuery({
    name: 'projectIds',
    required: false,
    description:
      'Filter by project ID(s). Can be a single project ID or multiple project IDs as an array.',
    type: [String],
    isArray: true,
  })
  @ApiQuery({
    name: 'page',
    required: false,
    type: Number,
    description: 'Page number (default: 1)',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    type: Number,
    description: 'Items per page (default: 20, max: 100)',
  })
  @ApiResponse({
    status: 200,
    description: 'Search results with relevance ranking and highlighted snippets',
    type: SearchContributionsResponseDto,
  })
  @ApiResponse({ status: 400, description: 'Invalid search query (too short or too long)' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async search(
    @Query() query: SearchContributionsQueryDto,
    @CurrentUser('id') currentUserId: string,
  ): Promise<SearchContributionsResponseDto> {
    return this.contributionSearchService.search(query, currentUserId);
  }

  @Post(':id/submit')
  @RequireEntity('contribution')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Submit a contribution for review',
    description:
      'Transition a contribution from DRAFT to SUBMITTED. Only the author can submit. ' +
      'Only DRAFT contributions can be submitted. Use this endpoint explicitly; ' +
      'status cannot be changed via PATCH update.',
  })
  @ApiParam({ name: 'id', description: 'Contribution ID' })
  @ApiResponse({
    status: 200,
    description: 'Contribution submitted successfully',
    type: ContributionResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid status transition (only DRAFT→SUBMITTED) or invalid ID format',
  })
  @ApiResponse({
    status: 403,
    description: 'Not authorized to submit this contribution',
  })
  @ApiResponse({ status: 404, description: 'Contribution not found' })
  async submit(
    @Param('id', CuidValidationPipe) id: string,
    @CurrentUser('id') authorId: string,
  ): Promise<ContributionResponseDto> {
    return this.contributionsService.submitContribution(id, authorId);
  }

  @Post(':id/revert-to-draft')
  @RequireEntity('contribution')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Revert a rejected contribution to draft',
    description:
      'Only the author can revert a REJECTED contribution to DRAFT to edit and resubmit. ' +
      'Reviewer comment, reviewerId, and reviewedAt are preserved so the author can still see feedback. ' +
      'No resubmission limit; the same reviewer may approve or reject again after resubmit.',
  })
  @ApiParam({ name: 'id', description: 'Contribution ID' })
  @ApiResponse({
    status: 200,
    description: 'Contribution reverted to draft successfully',
    type: ContributionResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: 'Only REJECTED contributions can be reverted or invalid ID format',
  })
  @ApiResponse({
    status: 403,
    description: 'Not authorized (author only)',
  })
  @ApiResponse({ status: 404, description: 'Contribution not found' })
  async revertToDraft(
    @Param('id', CuidValidationPipe) id: string,
    @CurrentUser('id') authorId: string,
  ): Promise<ContributionResponseDto> {
    return this.contributionsService.revertToDraft(id, authorId);
  }

  @Patch(':id/approve')
  @RequireEntity('contribution-review')
  @ApiOperation({
    summary: 'Approve a contribution',
    description:
      "Transition a contribution from SUBMITTED to APPROVED. Only users assigned as reviewer to the contribution's project can approve (admin assigns reviewers per project; roles are dynamic). Approval requires a reviewer comment. reviewerComment is persisted and included in the approval email to the author.",
  })
  @ApiParam({ name: 'id', description: 'Contribution ID' })
  @ApiResponse({
    status: 200,
    description: 'Contribution approved successfully',
    type: ContributionResponseDto,
  })
  @ApiResponse({
    status: 400,
    description:
      'Invalid status transition (only SUBMITTED→APPROVED), missing reviewer comment, or invalid ID format',
  })
  @ApiResponse({
    status: 403,
    description:
      "Not assigned as reviewer for this contribution's project or missing contribution-review entity access",
  })
  @ApiResponse({ status: 404, description: 'Contribution not found' })
  async approve(
    @Param('id', CuidValidationPipe) id: string,
    @Body() dto: ApproveContributionDto,
    @CurrentUser('id') reviewerId: string,
  ): Promise<ContributionResponseDto> {
    return this.contributionsService.approveContribution(id, reviewerId, dto);
  }

  @Patch(':id/reject')
  @RequireEntity('contribution-review')
  @ApiOperation({
    summary: 'Reject a contribution',
    description:
      "Transition a contribution from SUBMITTED to REJECTED. Only users assigned as reviewer to the contribution's project can reject (admin assigns reviewers per project; roles are dynamic). Rejection requires a reviewer comment. reviewerId and reviewerComment are persisted; contributors can retrieve rejection reasons via GET /contributions/:id or GET /contributions/my.",
  })
  @ApiParam({ name: 'id', description: 'Contribution ID' })
  @ApiResponse({
    status: 200,
    description: 'Contribution rejected successfully',
    type: ContributionResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid status transition, missing reviewer comment, or invalid ID format',
  })
  @ApiResponse({
    status: 403,
    description:
      "Not assigned as reviewer for this contribution's project or missing contribution-review entity access",
  })
  @ApiResponse({ status: 404, description: 'Contribution not found' })
  async reject(
    @Param('id', CuidValidationPipe) id: string,
    @Body() dto: RejectContributionDto,
    @CurrentUser('id') reviewerId: string,
  ): Promise<ContributionResponseDto> {
    return this.contributionsService.rejectContribution(id, reviewerId, dto);
  }

  @Get(':id')
  @RequireEntity('contribution', 'contribution-review', 'vault')
  @ApiOperation({
    summary: 'Get contribution by ID',
    description: 'Get a specific contribution. Access depends on visibility level.',
  })
  @ApiParam({ name: 'id', description: 'Contribution ID' })
  @ApiResponse({
    status: 200,
    description: 'Contribution details',
    type: ContributionResponseDto,
  })
  @ApiResponse({ status: 400, description: 'Invalid ID format' })
  @ApiResponse({ status: 403, description: 'Access denied' })
  @ApiResponse({ status: 404, description: 'Contribution not found' })
  async findOne(
    @Param('id', CuidValidationPipe) id: string,
    @CurrentUser('id') authorId: string,
  ): Promise<ContributionResponseDto> {
    return this.contributionsService.findOne(id, authorId);
  }

  @Get(':id/history')
  @RequireEntity('contribution', 'contribution-review')
  @ApiOperation({
    summary: 'Get contribution history (audit timeline)',
    description:
      'Returns a timeline of actions performed on a contribution (created, edited, submitted, approved, rejected, reverted, deleted). ' +
      'Uses audit logs captured by the backend. Access is enforced similarly to GET /contributions/:id.',
  })
  @ApiParam({ name: 'id', description: 'Contribution ID (CUID format)' })
  @ApiResponse({
    status: 200,
    description: 'Contribution history entries',
    type: ContributionHistoryResponseDto,
  })
  @ApiResponse({ status: 400, description: 'Invalid ID format' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Access denied' })
  @ApiResponse({ status: 404, description: 'Contribution not found' })
  async getHistory(
    @Param('id', CuidValidationPipe) id: string,
    @CurrentUser('id') currentUserId: string,
  ): Promise<ContributionHistoryResponseDto> {
    return this.contributionsService.getHistory(id, currentUserId);
  }

  @Patch(':id')
  @RequireEntity('contribution')
  @ApiOperation({
    summary: 'Update a contribution',
    description:
      'Update a contribution. Only the author can update, and only when status is DRAFT. ' +
      'Can update projectId to change which project the contribution belongs to. ' +
      'After a rejection, use POST /contributions/:id/revert-to-draft first, then update and submit again. ' +
      'The solution, outcome, and learnings fields support rich text (HTML).',
  })
  @ApiParam({ name: 'id', description: 'Contribution ID (CUID format)' })
  @ApiBody({
    description: 'Contribution data to update (all fields optional, including projectId)',
    type: UpdateContributionDto,
  })
  @ApiResponse({
    status: 200,
    description: 'Contribution updated successfully',
    type: ContributionResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: 'Validation error, contribution is not in DRAFT status, or invalid ID format',
  })
  @ApiResponse({
    status: 403,
    description: 'Not authorized to update this contribution',
  })
  @ApiResponse({
    status: 404,
    description: 'Contribution not found or project not found (if projectId updated)',
  })
  async update(
    @Param('id', CuidValidationPipe) id: string,
    @Body() dto: UpdateContributionDto,
    @CurrentUser('id') authorId: string,
  ): Promise<ContributionResponseDto> {
    return this.contributionsService.update(id, authorId, dto);
  }

  @Delete(':id')
  @RequireEntity('contribution')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Delete a contribution',
    description:
      'Delete a contribution. Only the author can delete their own contribution. ' +
      'Contributions that have been reviewed (approved or rejected) by any reviewer cannot be deleted.',
  })
  @ApiParam({ name: 'id', description: 'Contribution ID' })
  @ApiResponse({ status: 204, description: 'Contribution deleted successfully' })
  @ApiResponse({ status: 400, description: 'Invalid ID format' })
  @ApiResponse({
    status: 403,
    description:
      'Not authorized to delete this contribution, or contribution has been reviewed and cannot be deleted',
  })
  @ApiResponse({ status: 404, description: 'Contribution not found' })
  async delete(
    @Param('id', CuidValidationPipe) id: string,
    @CurrentUser('id') authorId: string,
  ): Promise<void> {
    return this.contributionsService.delete(id, authorId);
  }
}
