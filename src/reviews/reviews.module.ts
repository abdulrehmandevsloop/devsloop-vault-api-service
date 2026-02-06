import { Module } from '@nestjs/common';
import { ReviewsService } from './reviews.service';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [], // Controller removed - empty placeholder
  providers: [ReviewsService],
  exports: [ReviewsService],
})
export class ReviewsModule {}
