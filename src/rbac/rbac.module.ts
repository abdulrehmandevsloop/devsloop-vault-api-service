import { Module } from '@nestjs/common';
import { AclController } from './rbac.controller';
import { RolesController } from './roles.controller';
import { AclService } from './rbac.service';
import { PrismaModule } from '../prisma';
import { QueueModule } from '../queue/queue.module';

@Module({
  imports: [PrismaModule, QueueModule],
  controllers: [AclController, RolesController],
  providers: [AclService],
  exports: [AclService],
})
export class AclModule {}
