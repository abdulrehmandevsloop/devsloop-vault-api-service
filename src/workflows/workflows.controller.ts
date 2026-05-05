import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { RequireEntity } from 'src/common/decorators';
import { CuidValidationPipe } from 'src/common/pipes/cuid-validation.pipe';
import {
  CreateWorkflowTemplateDto,
  QueryWorkflowTemplatesDto,
  UpdateWorkflowTemplateDto,
} from './dto';
import { WorkflowTemplateService } from './workflow-template.service';

@ApiTags('Workflows')
@ApiBearerAuth('JWT-auth')
@RequireEntity('workflow')
@Controller('workflows')
export class WorkflowsController {
  constructor(private readonly templateService: WorkflowTemplateService) {}

  @Post('templates')
  @ApiOperation({ summary: 'Create a workflow template' })
  create(@Body() dto: CreateWorkflowTemplateDto) {
    return this.templateService.create(dto);
  }

  @Get('templates')
  @ApiOperation({ summary: 'List all active workflow templates' })
  findAll(@Query() query: QueryWorkflowTemplatesDto) {
    return this.templateService.findAll(query);
  }

  @Get('templates/:id')
  @ApiOperation({ summary: 'Get a workflow template by ID' })
  @ApiParam({ name: 'id', description: 'Template ID' })
  findOne(@Param('id', CuidValidationPipe) id: string) {
    return this.templateService.findOne(id);
  }

  @Patch('templates/:id')
  @ApiOperation({ summary: 'Update a workflow template (increments version)' })
  @ApiParam({ name: 'id', description: 'Template ID' })
  update(@Param('id', CuidValidationPipe) id: string, @Body() dto: UpdateWorkflowTemplateDto) {
    return this.templateService.update(id, dto);
  }

  @Post('templates/:id/publish')
  @ApiOperation({ summary: 'Publish a workflow template (make it available to users)' })
  @ApiParam({ name: 'id', description: 'Template ID' })
  publish(@Param('id', CuidValidationPipe) id: string) {
    return this.templateService.publish(id);
  }

  @Post('templates/:id/unpublish')
  @ApiOperation({ summary: 'Revert a workflow template to draft' })
  @ApiParam({ name: 'id', description: 'Template ID' })
  unpublish(@Param('id', CuidValidationPipe) id: string) {
    return this.templateService.unpublish(id);
  }

  @Delete('templates/:id')
  @ApiOperation({ summary: 'Soft-deactivate a workflow template' })
  @ApiParam({ name: 'id', description: 'Template ID' })
  deactivate(@Param('id', CuidValidationPipe) id: string) {
    return this.templateService.deactivate(id);
  }

  @Post('templates/:id/reactivate')
  @ApiOperation({ summary: 'Reactivate a deactivated workflow template' })
  @ApiParam({ name: 'id', description: 'Template ID' })
  reactivate(@Param('id', CuidValidationPipe) id: string) {
    return this.templateService.reactivate(id);
  }
}
