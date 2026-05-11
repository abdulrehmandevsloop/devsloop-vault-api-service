import { Module } from '@nestjs/common';
import { QueueModule } from '../queue/queue.module';
import { ContactController } from './contact.controller';
import { ContactService } from './contact.service';

@Module({
  imports: [QueueModule],
  controllers: [ContactController],
  providers: [ContactService],
})
export class ContactModule {}
