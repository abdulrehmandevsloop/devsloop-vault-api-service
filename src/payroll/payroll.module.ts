import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma';
import { PayrollController } from './payroll.controller';
import { PayrollService } from './payroll.service';
import { PayrollCalculationService } from './payroll-calculation.service';
import { PayrollBulkAdjustmentService } from './payroll-bulk-adjustment.service';
import { PayrollXlsxExportService } from './payroll-xlsx-export.service';
import { PayrollRemittanceExportService } from './payroll-remittance-export.service';

@Module({
  imports: [PrismaModule],
  controllers: [PayrollController],
  providers: [
    PayrollService,
    PayrollCalculationService,
    PayrollBulkAdjustmentService,
    PayrollXlsxExportService,
    PayrollRemittanceExportService,
  ],
  exports: [PayrollService, PayrollCalculationService],
})
export class PayrollModule {}
