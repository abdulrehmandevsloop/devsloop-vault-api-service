import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma';
import { PayrollController } from './payroll.controller';
import { PayrollService } from './payroll.service';
import { PayrollCalculationService } from './payroll-calculation.service';

@Module({
  imports: [PrismaModule],
  controllers: [PayrollController],
  providers: [PayrollService, PayrollCalculationService],
  exports: [PayrollService, PayrollCalculationService],
})
export class PayrollModule {}
