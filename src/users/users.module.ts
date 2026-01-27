import { Module } from '@nestjs/common';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import { UserQueryService, UserValidationService } from './services';
import { UserEmailHandler, UserAuditHandler } from './listeners';
import { QueueModule } from '../queue/queue.module';
import { PrismaModule } from '../prisma';
import { AclModule } from '../rbac';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [PrismaModule, QueueModule, AclModule, AuthModule],
  controllers: [UsersController],
  providers: [
    UsersService,
    UserQueryService,
    UserValidationService,
    // Event Handlers
    UserEmailHandler,
    UserAuditHandler,
  ],
  exports: [UsersService],
})
export class UsersModule {}
