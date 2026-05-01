import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';
import helmet from 'helmet';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const port = parseInt(process.env.PORT || '3001', 10);
  const logger = new Logger('Bootstrap');
  const env = process.env.NODE_ENV ?? 'development';
  const isStaging = env === 'staging';

  app.enableShutdownHooks();
  app.setGlobalPrefix('api/v1', { exclude: ['/'] });
  app.getHttpAdapter().getInstance().set('trust proxy', true);

  // Body parser limits for rich text content with embedded images
  app.useBodyParser('json', { limit: '10mb' });
  app.useBodyParser('urlencoded', { limit: '10mb', extended: true });

  // Security headers
  app.use(
    helmet({
      contentSecurityPolicy: isStaging
        ? false
        : {
            directives: {
              defaultSrc: ["'self'"],
              styleSrc: ["'self'", "'unsafe-inline'"],
              scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
              imgSrc: ["'self'", 'data:', 'https:'],
            },
          },
      crossOriginOpenerPolicy: false,
      crossOriginResourcePolicy: { policy: 'cross-origin' },
      hsts: isStaging ? false : { maxAge: 31536000, includeSubDomains: true },
    }),
  );

  // CORS
  const allowedOrigins = (process.env.FRONTEND_URL || 'http://localhost:3000')
    .split(',')
    .map((o) => o.trim().replace(/\/+$/, ''));

  app.enableCors({
    origin: isStaging
      ? true
      : (origin, callback) => {
          if (!origin || allowedOrigins.includes(origin)) {
            return callback(null, true);
          }
          logger.warn(`CORS blocked: ${origin}`);
          callback(new Error(`Origin ${origin} not allowed by CORS`));
        },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Accept', 'X-Requested-With'],
    preflightContinue: false,
    optionsSuccessStatus: 204,
  });

  // Global pipes, filters, interceptors
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );
  app.useGlobalFilters(new HttpExceptionFilter());
  app.useGlobalInterceptors(new LoggingInterceptor());

  // Swagger
  const swaggerServer = isStaging
    ? { url: process.env.API_URL || 'http://localhost:3001', desc: 'Staging' }
    : {
        url: process.env.API_URL || 'https://vault-api.devslooptech.com/api/v1/docs',
        desc: 'Production',
      };

  const config = new DocumentBuilder()
    .setTitle('DevsLoop Vault API')
    .setDescription('Internal Knowledge Management Platform API')
    .setVersion('1.0')
    .addServer(swaggerServer.url, swaggerServer.desc)
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
    .addTag('Admin - Projects', 'Admin endpoints for project management')
    .addTag('Admin - User Project Assignments', 'Admin assign projects to users')
    .addTag('Admin - Payroll', 'Payroll periods, calculations, and bank export')
    .addTag('Contributions', 'Contribution management endpoints')
    .addTag('Leaves – Employee', 'Employee-facing leave and WFH endpoints')
    .addTag('Leaves – Team Lead Review', 'Team Lead leave review and stage-1 approvals')
    .addTag('Leaves – HR Management', 'HR leave management, approvals, and statistics')
    .build();

  SwaggerModule.setup('api/v1/docs', app, SwaggerModule.createDocument(app, config), {
    swaggerOptions: {
      persistAuthorization: true,
      url: '/api/v1/docs-json',
      supportedSubmitMethods: ['get', 'post', 'put', 'patch', 'delete'],
      validatorUrl: null,
    },
    customSiteTitle: 'DevsLoop Vault API Docs',
    customCss: `.swagger-ui .topbar { display: none; }`,
  });

  await app.listen(port, '0.0.0.0');

  logger.log(`Server running on http://0.0.0.0:${port} [${isStaging ? 'staging' : 'production'}]`);
  logger.log(`Swagger docs: http://0.0.0.0:${port}/api/v1/docs`);
  logger.log(`CORS origins: ${allowedOrigins.join(', ')}`);
}

void bootstrap();
