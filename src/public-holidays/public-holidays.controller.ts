import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Roles } from '../common/decorators/roles.decorator';
import { CuidValidationPipe } from '../common/pipes/cuid-validation.pipe';
import { CreatePublicHolidayDto, PublicHolidayResponseDto } from './dto';
import { PublicHolidaysService } from './public-holidays.service';

@ApiTags('Public Holidays')
@Controller('public-holidays')
export class PublicHolidaysController {
  constructor(private readonly service: PublicHolidaysService) {}

  @Get()
  @ApiOperation({ summary: 'List all public holidays' })
  findAll(): Promise<PublicHolidayResponseDto[]> {
    return this.service.findAll();
  }

  @Post()
  @Roles('ADMIN')
  @ApiOperation({ summary: 'Create a public holiday (Admin only)' })
  create(@Body() dto: CreatePublicHolidayDto): Promise<PublicHolidayResponseDto> {
    return this.service.create(dto);
  }

  @Delete(':id')
  @Roles('ADMIN')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a public holiday (Admin only)' })
  remove(@Param('id', CuidValidationPipe) id: string): Promise<void> {
    return this.service.remove(id);
  }
}
