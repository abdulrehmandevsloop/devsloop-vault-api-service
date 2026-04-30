import { Controller, Get } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { AclService } from './rbac.service';
import { RoleListItemDto } from 'src/rbac/dto';
import { RequireEntity } from 'src/common';

@ApiTags('Admin - Roles')
@ApiBearerAuth('JWT-auth')
@Controller('roles')
export class RolesController {
  constructor(private readonly aclService: AclService) {}

  @Get('list')
  @RequireEntity('role', 'project')
  @ApiOperation({
    summary: 'Get simplified roles list',
    description:
      'Get a simplified list of all roles with id, name, displayName, and isActive fields. Used for admin user management.',
  })
  @ApiResponse({
    status: 200,
    description: 'List of roles',
    type: [RoleListItemDto],
  })
  async getRolesList(): Promise<RoleListItemDto[]> {
    return this.aclService.getRolesList();
  }
}
