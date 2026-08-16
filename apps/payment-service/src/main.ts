import { NestFactory } from '@nestjs/core';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';
import { AllRpcExceptionsFilter } from '@app/common';
import { PaymentServiceModule } from './payment-service.module';

async function bootstrap() {
  // Hybrid app: TCP for inter-service messaging, plus a small HTTP server that
  // serves /health/live and /health/ready for the Kubernetes probes.
  const app = await NestFactory.create(PaymentServiceModule);

  app.connectMicroservice<MicroserviceOptions>({
    transport: Transport.TCP,
    options: {
      host: process.env.SERVICE_HOST || '0.0.0.0',
      port: parseInt(process.env.SERVICE_PORT || '3005', 10),
    },
  });

  app.useGlobalFilters(new AllRpcExceptionsFilter());
  app.enableShutdownHooks();

  await app.startAllMicroservices();

  const healthPort = parseInt(process.env.HEALTH_PORT || '8080', 10);
  await app.listen(healthPort, '0.0.0.0');
  console.log(
    `payment-service TCP on ${process.env.SERVICE_PORT || '3005'}, health on ${healthPort}`,
  );
}
bootstrap();
