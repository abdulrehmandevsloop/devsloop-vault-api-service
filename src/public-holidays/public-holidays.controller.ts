import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequireEntity } from '../common/decorators/require-entity.decorator';
import { CuidValidationPipe } from '../common/pipes/cuid-validation.pipe';
import { CreatePublicHolidayDto, PublicHolidayResponseDto } from './dto';
import { PublicHolidaysService } from './public-holidays.service';

@ApiTags('Public Holidays')
@Controller('public-holidays')
export class PublicHolidaysController {
  constructor(private readonly service: PublicHolidaysService) {}

  @Get()
  @RequireEntity('user', 'system-config')
  @ApiOperation({ summary: 'List all public holidays' })
  findAll(): Promise<PublicHolidayResponseDto[]> {
    return this.service.findAll();
  }

  @Post()
  @RequireEntity('user', 'system-config')
  @ApiOperation({ summary: 'Create a public holiday (Admin only)' })
  create(@Body() dto: CreatePublicHolidayDto): Promise<PublicHolidayResponseDto> {
    return this.service.create(dto);
  }

  @Delete(':id')
  @RequireEntity('user', 'system-config')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a public holiday (Admin only)' })
  remove(@Param('id', CuidValidationPipe) id: string): Promise<void> {
    return this.service.remove(id);
  }
}
