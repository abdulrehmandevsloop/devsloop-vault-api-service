import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';
import helmet from 'helmet';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const port = process.env.PORT ?? 3001;
  const logger = new Logger('Bootstrap');

  // Trust proxy to get correct protocol (important for local network access)
  app.getHttpAdapter().getInstance().set('trust proxy', true);

  // Security headers (configured for development and local network)
  const isDevelopment = process.env.NODE_ENV !== 'production';

  app.use(
    helmet({
      contentSecurityPolicy: isDevelopment
        ? false // Disable CSP in development for Swagger UI
        : {
            directives: {
              defaultSrc: ["'self'"],
              styleSrc: ["'self'", "'unsafe-inline'"],
              scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
              imgSrc: ["'self'", 'data:', 'https:'],
            },
          },
      crossOriginOpenerPolicy: false, // Disable for local network access
      crossOriginResourcePolicy: { policy: 'cross-origin' },
      // Disable HSTS in development to allow HTTP
      hsts: isDevelopment
        ? false
        : {
            maxAge: 31536000,
            includeSubDomains: true,
            preload: false,
          },
    }),
  );

  // API versioning
  app.setGlobalPrefix('api/v1');

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
    .addServer('http://localhost:3001', 'Local Development')
    .addServer('https://devsloop-vault-api-service.vercel.app', 'Production')
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
    .addTag('Admin - Projects', 'Admin endpoints for project management')
    .addTag('Contributions', 'Contribution management endpoints')
    .addTag('Tags', 'Tag management endpoints')
    .addTag('Bookmarks', 'Bookmark management endpoints')
    .addTag('Audit', 'Audit log endpoints')
    .addTag('Notifications', 'Notification endpoints')
    .build();

  const document = SwaggerModule.createDocument(app, config);

  // Configure Swagger UI with protocol fix
  SwaggerModule.setup('api/v1/docs', app, document, {
    swaggerOptions: {
      persistAuthorization: true,
      url: '/api/v1/docs-json',
      supportedSubmitMethods: ['get', 'post', 'put', 'patch', 'delete'],
      validatorUrl: null, // Disable validator to prevent external requests
    },
    customSiteTitle: 'DevsLoop Vault API Docs',
    customCss: `
      .swagger-ui .topbar { display: none; }
      .swagger-ui .info { margin: 20px 0; }
    `,
  });

  // Middleware to fix Swagger UI protocol issues for local network
  // Intercepts all Swagger responses (HTML, CSS, JS) and fixes HTTPS URLs to HTTP
  app.use('/api/v1/docs', (req: any, res: any, next: any) => {
    const originalSend = res.send.bind(res);
    res.send = function (body: any) {
      if (typeof body === 'string' && req.protocol === 'http') {
        const host = req.get('host');
        // Replace all HTTPS URLs for this host with HTTP
        const escapedHost = host.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const httpsPattern = new RegExp(`https://${escapedHost}`, 'gi');
        body = body.replace(httpsPattern, `http://${host}`);
        // Also fix any IP-based HTTPS URLs (192.168.x.x)
        body = body.replace(/https:\/\/(192\.168\.\d+\.\d+:\d+)/g, 'http://$1');
        body = body.replace(/https:\/\/localhost:\d+/g, (match: string) =>
          match.replace('https://', 'http://'),
        );
      }
      return originalSend(body);
    };
    next();
  });

  await app.listen(port);

  logger.log(`🚀 Server is running on: http://localhost:${port}`, 'Bootstrap');
  logger.log(`📚 Environment: ${process.env.NODE_ENV || 'development'}`, 'Bootstrap');
  logger.log(`📖 API Version: v1`, 'Bootstrap');
  logger.log(`📖 Swagger docs available at: http://localhost:${port}/api/v1/docs`, 'Bootstrap');
}
void bootstrap();
