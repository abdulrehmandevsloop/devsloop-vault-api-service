import { Controller, Get, Query, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { AuditService } from './audit.service';
import { AuditQueryDto } from './dto/audit-query.dto';
import { PaginatedAuditLogsResponseDto, AuditFilterOptionsDto } from './dto/audit-response.dto';
import { RequireEntity } from '../common';

@ApiTags('Admin - Audit Logs')
@ApiBearerAuth('JWT-auth')
@Controller('admin/audit-logs')
export class AuditController {
  constructor(private readonly auditService: AuditService) {}

  @Get()
  @RequireEntity('audit-log')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Get audit logs with filters and pagination',
    description:
      'Admin endpoint to list all audit logs. Supports filtering by action, entity type, user, date range, and search.',
  })
  @ApiResponse({
    status: 200,
    description: 'Paginated list of audit logs',
    type: PaginatedAuditLogsResponseDto,
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden — insufficient permissions' })
  async findAll(@Query() query: AuditQueryDto): Promise<PaginatedAuditLogsResponseDto> {
    return this.auditService.findAll(query);
  }

  @Get('filters')
  @RequireEntity('audit-log')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Get audit log filter options',
    description: 'Returns distinct action types and entity types for populating filter dropdowns.',
  })
  @ApiResponse({
    status: 200,
    description: 'Filter options',
    type: AuditFilterOptionsDto,
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden — insufficient permissions' })
  async getFilterOptions(): Promise<AuditFilterOptionsDto> {
    return this.auditService.getFilterOptions();
  }
}
