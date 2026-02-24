import { Module } from '@nestjs/common';
import { WarningsController } from './warnings.controller';
import { WarningsService } from './warnings.service';
import { PrismaModule } from '../prisma';

@Module({
  imports: [PrismaModule],
  controllers: [WarningsController],
  providers: [WarningsService],
  exports: [WarningsService],
})
export class WarningsModule {}
