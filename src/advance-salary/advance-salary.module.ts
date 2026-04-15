import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma';
import { RequestContextModule } from 'src/common/services/request-context.module';
import { AclModule } from 'src/rbac/rbac.module';
import { AdvanceSalaryController } from 'src/advance-salary/advance-salary.controller';
import { AdvanceSalaryReviewController } from 'src/advance-salary/advance-salary-review.controller';
import { AdvanceSalaryService } from 'src/advance-salary/advance-salary.service';

@Module({
  imports: [PrismaModule, RequestContextModule, AclModule],
  controllers: [AdvanceSalaryController, AdvanceSalaryReviewController],
  providers: [AdvanceSalaryService],
  exports: [AdvanceSalaryService],
})
export class AdvanceSalaryModule {}
