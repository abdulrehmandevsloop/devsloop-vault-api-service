import { Module } from '@nestjs/common';
import { UserProjectsController } from './user-projects.controller';
import { UserProjectsService } from './user-projects.service';
import { PrismaModule } from '../prisma';

@Module({
  imports: [PrismaModule],
  controllers: [UserProjectsController],
  providers: [UserProjectsService],
  exports: [UserProjectsService],
})
export class UserProjectsModule {}
