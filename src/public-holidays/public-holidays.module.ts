import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma';
import { PublicHolidaysController } from './public-holidays.controller';
import { PublicHolidaysService } from './public-holidays.service';

@Module({
  imports: [PrismaModule],
  controllers: [PublicHolidaysController],
  providers: [PublicHolidaysService],
  exports: [PublicHolidaysService],
})
export class PublicHolidaysModule {}
