import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma';
import { SystemConfigModule } from 'src/system-config';
import { QueueModule } from 'src/queue/queue.module';
import { RequestContextModule } from 'src/common/services/request-context.module';
import { AclModule } from 'src/rbac/rbac.module';
import { PayrollController } from './payroll.controller';
import { PayrollEmployeeController } from './payroll-employee.controller';
import { PayrollService } from './payroll.service';
import { PayrollCalculationService } from './payroll-calculation.service';
import { PayrollBulkAdjustmentService } from './payroll-bulk-adjustment.service';
import { PayrollXlsxExportService } from './payroll-xlsx-export.service';
import { PayrollRemittanceExportService } from './payroll-remittance-export.service';
import { PayrollReviewEmailHandler } from './listeners/payroll-review-email.handler';
import { PayrollReviewAuditHandler } from './listeners/payroll-review-audit.handler';
import { LoanRecalibrationHandler } from './listeners/loan-recalibration.handler';
import { SalaryHoldRecalcHandler } from './listeners/salary-hold-recalc.handler';
import { SchedulerModule } from 'src/scheduler/scheduler.module';
import { SalaryHoldsModule } from 'src/salary-holds';

@Module({
  imports: [
    PrismaModule,
    SystemConfigModule,
    QueueModule,
    RequestContextModule,
    AclModule,
    SchedulerModule,
    SalaryHoldsModule,
  ],
  controllers: [PayrollController, PayrollEmployeeController],
  providers: [
    PayrollService,
    PayrollCalculationService,
    PayrollBulkAdjustmentService,
    PayrollXlsxExportService,
    PayrollRemittanceExportService,
    PayrollReviewEmailHandler,
    PayrollReviewAuditHandler,
    LoanRecalibrationHandler,
    SalaryHoldRecalcHandler,
  ],
  exports: [PayrollService, PayrollCalculationService],
})
export class PayrollModule {}
