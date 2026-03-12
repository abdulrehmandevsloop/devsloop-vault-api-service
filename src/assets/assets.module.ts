import { Module } from '@nestjs/common';
import { AssetsController } from './assets.controller';
import { AssetsUserController } from './assets-user.controller';
import { AssetsService } from './assets.service';
import { AssetEventHandler } from './listeners/asset-event.handler';
import { AssetAuditHandler } from './listeners/asset-audit.handler';
import { PrismaModule } from '../prisma/prisma.module';
import { QueueModule } from '../queue/queue.module';

@Module({
  imports: [PrismaModule, QueueModule],
  controllers: [AssetsController, AssetsUserController],
  providers: [AssetsService, AssetEventHandler, AssetAuditHandler],
  exports: [AssetsService],
})
export class AssetsModule {}
