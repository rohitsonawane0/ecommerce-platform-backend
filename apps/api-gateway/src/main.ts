// apps/api-gateway/src/main.ts
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';

import helmet from 'helmet';
import { ApiGatewayModule } from './api-gateway.module';
import { AllExceptionsFilter, ResponseInterceptor } from '@app/common';

async function bootstrap() {
  const app = await NestFactory.create(ApiGatewayModule);

  app.use(helmet());
  app.enableCors({
    origin: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );
  app.useGlobalInterceptors(new ResponseInterceptor());
  app.useGlobalFilters(new AllExceptionsFilter());

  // Probes live at /health/*, outside the versioned API prefix, so the same
  // probe paths work on every service.
  app.setGlobalPrefix('api/v1', {
    exclude: ['health/live', 'health/ready'],
  });
  const port = process.env.GATEWAY_PORT || 3000;
  await app.listen(port);
  console.log(`API Gateway running on port ${port}`);
}
bootstrap();
