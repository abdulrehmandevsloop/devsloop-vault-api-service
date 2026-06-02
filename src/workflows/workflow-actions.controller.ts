import { Body, Controller, Get, Param, ParseIntPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiQuery, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from 'src/common';
import { CuidValidationPipe } from 'src/common/pipes/cuid-validation.pipe';
import { PrismaService } from 'src/prisma';
import { AclService } from 'src/rbac/rbac.service';
import { QueryWorkflowInstancesDto, WorkflowActionDto } from './dto';
import { WorkflowEngineService } from './workflow-engine.service';
import { WorkflowApproverService } from './workflow-approver.service';
import { WorkflowTemplateService } from './workflow-template.service';

@ApiTags('Workflows')
@ApiBearerAuth('JWT-auth')
@Controller('workflows')
export class WorkflowActionsController {
  constructor(
    private readonly engine: WorkflowEngineService,
    private readonly prisma: PrismaService,
    private readonly aclService: AclService,
    private readonly approver: WorkflowApproverService,
    private readonly templateService: WorkflowTemplateService,
  ) {}

  @Get('meta/entities')
  @ApiOperation({ summary: 'List active entities available as workflow approver targets' })
  getMetaEntities() {
    return this.prisma.entity.findMany({
      where: { isActive: true },
      select: { id: true, name: true, displayName: true, description: true },
      orderBy: { displayName: 'asc' },
    });
  }

  @Get('meta/roles')
  @ApiOperation({ summary: 'List active roles available as workflow approver targets' })
  getMetaRoles() {
    return this.prisma.role.findMany({
      where: { isActive: true },
      select: { id: true, name: true, displayName: true, description: true },
      orderBy: { displayName: 'asc' },
    });
  }

  @Get('meta/users')
  @ApiOperation({
    summary: 'List active users for dropdown population (ALL_USERS data source)',
  })
  getMetaUsers() {
    return this.prisma.user.findMany({
      where: {
        employeeStatus: 'ACTIVE',
        approvalStatus: 'APPROVED',
        isSystem: false,
      },
      select: { id: true, name: true, email: true },
      orderBy: { name: 'asc' },
    });
  }

  @Get('meta/my-team-lead')
  @ApiOperation({ summary: 'Return the reporting manager (team lead) of the current user' })
  async getMyTeamLead(@CurrentUser('id') userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        teamLeadUser: { select: { id: true, name: true, email: true } },
      },
    });
    return user?.teamLeadUser ?? null;
  }

  @Get('available-templates')
  @ApiOperation({ summary: 'List published workflow templates visible to the current user' })
  getAvailableTemplates(@CurrentUser('id') userId: string) {
    return this.templateService.findAvailable(userId);
  }

  @Get('reviewable-types')
  @ApiOperation({ summary: 'Return request type keys the current user is eligible to review' })
  getReviewableTypes(@CurrentUser('id') userId: string): Promise<string[]> {
    return this.approver.getReviewableRequestTypes(userId);
  }

  @Get('instances/by-request')
  @ApiOperation({ summary: 'Get workflow instance for a specific domain request' })
  @ApiQuery({ name: 'requestType', type: String })
  @ApiQuery({ name: 'requestId', type: String })
  getInstanceByRequest(
    @Query('requestType') requestType: string,
    @Query('requestId') requestId: string,
  ) {
    return this.engine.findInstanceByRequest(requestType, requestId);
  }

  @Get('my-pending')
  @ApiOperation({ summary: 'Get workflow steps pending my action' })
  getMyPending(@CurrentUser('id') userId: string, @Query() query: QueryWorkflowInstancesDto) {
    return this.engine.getMyPending(userId, query);
  }

  @Get('my-requests')
  @ApiOperation({ summary: 'Get my submitted workflow requests' })
  getMyRequests(@CurrentUser('id') userId: string, @Query() query: QueryWorkflowInstancesDto) {
    return this.engine.getMyRequests(userId, query);
  }

  @Get('instances/:id')
  @ApiOperation({ summary: 'Get a workflow instance by ID' })
  @ApiParam({ name: 'id', description: 'Workflow instance ID' })
  getInstance(@Param('id', CuidValidationPipe) id: string) {
    return this.engine.getInstance(id);
  }

  @Post('instances/:id/steps/:stepOrder/approve')
  @ApiOperation({ summary: 'Approve a workflow step' })
  @ApiParam({ name: 'id', description: 'Workflow instance ID' })
  @ApiParam({ name: 'stepOrder', description: 'Step order number' })
  approve(
    @Param('id', CuidValidationPipe) id: string,
    @Param('stepOrder', ParseIntPipe) stepOrder: number,
    @Body() dto: WorkflowActionDto,
    @CurrentUser('id') actorId: string,
  ) {
    return this.engine.resolveStep(id, stepOrder, actorId, 'APPROVED', dto.comment);
  }

  @Post('instances/:id/steps/:stepOrder/reject')
  @ApiOperation({ summary: 'Reject a workflow step' })
  @ApiParam({ name: 'id', description: 'Workflow instance ID' })
  @ApiParam({ name: 'stepOrder', description: 'Step order number' })
  reject(
    @Param('id', CuidValidationPipe) id: string,
    @Param('stepOrder', ParseIntPipe) stepOrder: number,
    @Body() dto: WorkflowActionDto,
    @CurrentUser('id') actorId: string,
  ) {
    return this.engine.resolveStep(id, stepOrder, actorId, 'REJECTED', dto.comment);
  }

  @Post('instances/:id/steps/:stepOrder/return')
  @ApiOperation({ summary: 'Return a workflow step for revision' })
  @ApiParam({ name: 'id', description: 'Workflow instance ID' })
  @ApiParam({ name: 'stepOrder', description: 'Step order number' })
  return(
    @Param('id', CuidValidationPipe) id: string,
    @Param('stepOrder', ParseIntPipe) stepOrder: number,
    @Body() dto: WorkflowActionDto,
    @CurrentUser('id') actorId: string,
  ) {
    return this.engine.resolveStep(id, stepOrder, actorId, 'RETURNED', dto.comment);
  }

  @Post('instances/:id/cancel')
  @ApiOperation({ summary: 'Cancel a workflow instance (requester only)' })
  @ApiParam({ name: 'id', description: 'Workflow instance ID' })
  cancel(@Param('id', CuidValidationPipe) id: string, @CurrentUser('id') requesterId: string) {
    return this.engine.cancelWorkflow(id, requesterId);
  }
}
