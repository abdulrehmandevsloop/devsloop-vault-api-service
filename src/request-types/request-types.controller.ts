import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiQuery, ApiTags } from '@nestjs/swagger';
import { CuidValidationPipe } from 'src/common/pipes/cuid-validation.pipe';
import { RequireEntity } from 'src/common/decorators/require-entity.decorator';
import { CreateRequestTypeDto, UpdateRequestTypeDto } from './dto';
import { RequestTypesService } from './request-types.service';

@ApiTags('Request Types')
@ApiBearerAuth('JWT-auth')
@Controller('request-types')
export class RequestTypesController {
  constructor(private readonly service: RequestTypesService) {}

  @Get()
  @ApiQuery({ name: 'includeInactive', required: false, type: Boolean })
  findAll(@Query('includeInactive') includeInactive?: string) {
    return this.service.findAll(includeInactive === 'true');
  }

  @Post()
  @RequireEntity('workflow')
  create(@Body() dto: CreateRequestTypeDto) {
    return this.service.create(dto);
  }

  @Patch(':id')
  @RequireEntity('workflow')
  update(@Param('id', CuidValidationPipe) id: string, @Body() dto: UpdateRequestTypeDto) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  @RequireEntity('workflow')
  deactivate(@Param('id', CuidValidationPipe) id: string) {
    return this.service.deactivate(id);
  }

  @Post(':id/reactivate')
  @RequireEntity('workflow')
  reactivate(@Param('id', CuidValidationPipe) id: string) {
    return this.service.reactivate(id);
  }
}
