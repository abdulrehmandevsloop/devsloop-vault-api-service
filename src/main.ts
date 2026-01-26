import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const port = process.env.PORT ?? 3001;
  const logger = new Logger('Bootstrap');

  // Global prefix
  app.setGlobalPrefix('api');

  // CORS configuration for Next.js frontend
  app.enableCors({
    origin: process.env.CORS_ORIGIN || 'http://localhost:3000',
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  });

  // Global validation pipe
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: {
        enableImplicitConversion: true,
      },
    }),
  );

  // Global exception filter
  app.useGlobalFilters(new HttpExceptionFilter());

  // Global logging interceptor
  app.useGlobalInterceptors(new LoggingInterceptor());

  // Swagger/OpenAPI documentation
  const config = new DocumentBuilder()
    .setTitle('DevsLoop Vault API')
    .setDescription('Internal Knowledge Management Platform API')
    .setVersion('1.0')
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        name: 'JWT',
        description: 'Enter JWT token',
        in: 'header',
      },
      'JWT-auth',
    )
    .addTag('Authentication', 'User authentication endpoints')
    .addTag('Admin - Users', 'Admin endpoints for user approval management')
    .addTag('Users', 'User management endpoints')
    .addTag('Projects', 'Project management endpoints')
    .addTag('Contributions', 'Contribution management endpoints')
    .addTag('Tags', 'Tag management endpoints')
    .addTag('Bookmarks', 'Bookmark management endpoints')
    .addTag('Audit', 'Audit log endpoints')
    .addTag('Notifications', 'Notification endpoints')
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, document, {
    swaggerOptions: {
      persistAuthorization: true,
    },
  });

  await app.listen(port);

  logger.log(`🚀 Server is running on: http://localhost:${port}`, 'Bootstrap');
  logger.log(`📚 Environment: ${process.env.NODE_ENV || 'development'}`, 'Bootstrap');
  logger.log(`📖 Swagger docs available at: http://localhost:${port}/api/docs`, 'Bootstrap');
}
void bootstrap();
