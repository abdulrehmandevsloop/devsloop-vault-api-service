import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma';
import { RepaymentAutoDeductService } from './repayment-auto-deduct.service';
import { SchedulerController } from './scheduler.controller';

@Module({
  imports: [PrismaModule],
  controllers: [SchedulerController],
  providers: [RepaymentAutoDeductService],
  exports: [RepaymentAutoDeductService],
})
export class SchedulerModule {}
