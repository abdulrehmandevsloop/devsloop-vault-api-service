import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma';
import { RequestContextModule } from 'src/common/services/request-context.module';
import { AclModule } from 'src/rbac/rbac.module';
import { LoansController } from 'src/loans/loans.controller';
import { LoansReviewController } from 'src/loans/loans-review.controller';
import { LoansService } from 'src/loans/loans.service';

@Module({
  imports: [PrismaModule, RequestContextModule, AclModule],
  controllers: [LoansController, LoansReviewController],
  providers: [LoansService],
  exports: [LoansService],
})
export class LoansModule {}
