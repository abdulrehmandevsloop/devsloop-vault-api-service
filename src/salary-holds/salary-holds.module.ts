import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma';
import { RequestContextModule } from 'src/common/services/request-context.module';
import { AclModule } from 'src/rbac/rbac.module';
import { SalaryHoldsService } from './salary-holds.service';
import { SalaryHoldsHrController } from './salary-holds-hr.controller';

@Module({
  imports: [PrismaModule, RequestContextModule, AclModule],
  controllers: [SalaryHoldsHrController],
  providers: [SalaryHoldsService],
  exports: [SalaryHoldsService],
})
export class SalaryHoldsModule {}
