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

  @Delete('templates/:id')
  @ApiOperation({ summary: 'Soft-deactivate a workflow template' })
  @ApiParam({ name: 'id', description: 'Template ID' })
  deactivate(@Param('id', CuidValidationPipe) id: string) {
    return this.templateService.deactivate(id);
  }
}
