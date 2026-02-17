import { Global, MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { RequestContextService } from './request-context.service';
import { RequestContextMiddleware } from '../middleware/request-context.middleware';

@Global()
@Module({
  providers: [RequestContextService],
  exports: [RequestContextService],
})
export class RequestContextModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(RequestContextMiddleware).forRoutes('*');
  }
}
