import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma';
import { AclModule } from 'src/rbac/rbac.module';
import { AuditLogService } from 'src/auth/services/audit-log.service';
import { EventsController } from './events.controller';
import { MyEventsController } from './my-events.controller';
import { EventsService } from './events.service';

@Module({
  imports: [PrismaModule, AclModule],
  controllers: [EventsController, MyEventsController],
  providers: [EventsService, AuditLogService],
  exports: [EventsService],
})
export class EventsModule {}
