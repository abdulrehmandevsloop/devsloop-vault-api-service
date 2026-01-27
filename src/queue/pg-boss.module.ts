import { Module, Global } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PgBossService } from './pg-boss.service';

@Global()
@Module({
  imports: [ConfigModule],
  providers: [PgBossService],
  exports: [PgBossService],
})
export class PgBossModule {}
