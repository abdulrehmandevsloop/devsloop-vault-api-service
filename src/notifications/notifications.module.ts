import { Module } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [], // Controller removed - empty placeholder
  providers: [NotificationsService],
  exports: [NotificationsService],
})
export class NotificationsModule {}
