import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma';
import { SystemConfigModule } from 'src/system-config';
import { QueueModule } from 'src/queue/queue.module';
import { RequestContextModule } from 'src/common/services/request-context.module';
import { AclModule } from 'src/rbac/rbac.module';
import { PayrollController } from './payroll.controller';
import { PayrollService } from './payroll.service';
import { PayrollCalculationService } from './payroll-calculation.service';
import { PayrollBulkAdjustmentService } from './payroll-bulk-adjustment.service';
import { PayrollXlsxExportService } from './payroll-xlsx-export.service';
import { PayrollRemittanceExportService } from './payroll-remittance-export.service';
import { PayrollReviewEmailHandler } from './listeners/payroll-review-email.handler';
import { PayrollReviewAuditHandler } from './listeners/payroll-review-audit.handler';

@Module({
  imports: [PrismaModule, SystemConfigModule, QueueModule, RequestContextModule, AclModule],
  controllers: [PayrollController],
  providers: [
    PayrollService,
    PayrollCalculationService,
    PayrollBulkAdjustmentService,
    PayrollXlsxExportService,
    PayrollRemittanceExportService,
    PayrollReviewEmailHandler,
    PayrollReviewAuditHandler,
  ],
  exports: [PayrollService, PayrollCalculationService],
})
export class PayrollModule {}
