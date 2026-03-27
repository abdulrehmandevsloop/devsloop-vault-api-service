import { Module, forwardRef } from '@nestjs/common';
import { PrismaModule } from '../prisma';
import { WorklogsModule } from '../worklogs';
import { SystemConfigController } from './system-config.controller';
import { SystemConfigService } from './system-config.service';

@Module({
  imports: [PrismaModule, forwardRef(() => WorklogsModule)],
  controllers: [SystemConfigController],
  providers: [SystemConfigService],
  exports: [SystemConfigService],
})
export class SystemConfigModule {}
