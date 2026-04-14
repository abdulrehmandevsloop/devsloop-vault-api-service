import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma';
import { AclModule } from 'src/rbac/rbac.module';
import { ExpensesController } from 'src/expenses/expenses.controller';
import { ExpensesService } from 'src/expenses/expenses.service';

@Module({
  imports: [PrismaModule, AclModule],
  controllers: [ExpensesController],
  providers: [ExpensesService],
  exports: [ExpensesService],
})
export class ExpensesModule {}
