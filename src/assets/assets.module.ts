import { Module } from '@nestjs/common';
import { AssetsController } from './assets.controller';
import { AssetsUserController } from './assets-user.controller';
import { AssetsService } from './assets.service';
import { AssetEventHandler } from './listeners/asset-event.handler';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [AssetsController, AssetsUserController],
  providers: [AssetsService, AssetEventHandler],
  exports: [AssetsService],
})
export class AssetsModule {}
