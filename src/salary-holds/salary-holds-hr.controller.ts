import { Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CuidValidationPipe, CurrentUser, RequireEntity } from '../common';
import { SalaryHoldsService } from './salary-holds.service';
import { CreateSalaryHoldDto } from './dto/create-salary-hold.dto';
import { ExtendSalaryHoldDto } from './dto/extend-salary-hold.dto';

/**
 * HR-facing salary-hold management, surfaced from the User Management module.
 * Guarded by the `user` entity (the same access HR uses for employee admin).
 */
@ApiTags('Salary Holds (HR)')
@ApiBearerAuth()
@RequireEntity('user')
@Controller('admin')
export class SalaryHoldsHrController {
  constructor(private readonly salaryHolds: SalaryHoldsService) {}

  @Post('users/:userId/salary-hold')
  @ApiOperation({ summary: 'Place an employee’s salary on hold' })
  createHold(
    @Param('userId', CuidValidationPipe) userId: string,
    @Body() dto: CreateSalaryHoldDto,
    @CurrentUser('id') actorId: string,
  ) {
    return this.salaryHolds.createHold(userId, dto, actorId);
  }

  @Get('users/:userId/salary-hold')
  @ApiOperation({ summary: 'Get an employee’s active salary hold (if any)' })
  getActiveHold(@Param('userId', CuidValidationPipe) userId: string) {
    return this.salaryHolds.getActiveHoldForUser(userId);
  }

  @Patch('salary-holds/:holdId')
  @ApiOperation({ summary: 'Change a salary hold period (shorten or extend)' })
  changeHoldPeriod(
    @Param('holdId', CuidValidationPipe) holdId: string,
    @Body() dto: ExtendSalaryHoldDto,
    @CurrentUser('id') actorId: string,
  ) {
    return this.salaryHolds.changeHoldPeriod(holdId, dto, actorId);
  }

  @Post('salary-holds/:holdId/cancel')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Cancel a salary hold (only when no balance is held)' })
  cancelHold(
    @Param('holdId', CuidValidationPipe) holdId: string,
    @CurrentUser('id') actorId: string,
  ) {
    return this.salaryHolds.cancelHold(holdId, actorId);
  }
}
