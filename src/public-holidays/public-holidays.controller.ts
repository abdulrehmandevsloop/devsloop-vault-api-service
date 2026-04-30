import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { RequireEntity } from '../common/decorators/require-entity.decorator';
import { CuidValidationPipe } from '../common/pipes/cuid-validation.pipe';
import { CreatePublicHolidayDto, PublicHolidayResponseDto } from './dto';
import { PublicHolidaysService } from './public-holidays.service';

@ApiTags('Public Holidays')
@ApiBearerAuth('JWT-auth')
@Controller('public-holidays')
export class PublicHolidaysController {
  constructor(private readonly service: PublicHolidaysService) {}

  @Get()
  @RequireEntity('user', 'system-config')
  @ApiOperation({ summary: 'List all public holidays' })
  @ApiResponse({ status: 200, description: 'Array of public holidays' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  findAll(): Promise<PublicHolidayResponseDto[]> {
    return this.service.findAll();
  }

  @Post()
  @RequireEntity('user', 'system-config')
  @ApiOperation({ summary: 'Create a public holiday (Admin only)' })
  @ApiResponse({ status: 201, description: 'Public holiday created' })
  @ApiResponse({ status: 400, description: 'Validation error' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  create(@Body() dto: CreatePublicHolidayDto): Promise<PublicHolidayResponseDto> {
    return this.service.create(dto);
  }

  @Delete(':id')
  @RequireEntity('user', 'system-config')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a public holiday (Admin only)' })
  @ApiParam({ name: 'id', description: 'CUID of the public holiday' })
  @ApiResponse({ status: 204, description: 'Public holiday deleted' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  @ApiResponse({ status: 404, description: 'Public holiday not found' })
  remove(@Param('id', CuidValidationPipe) id: string): Promise<void> {
    return this.service.remove(id);
  }
}
