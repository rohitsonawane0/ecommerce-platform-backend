import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';

/**
 * Import into every service. On the TCP microservices this only works because
 * their main.ts creates a hybrid app (HTTP server + TCP microservice).
 */
@Module({
  controllers: [HealthController],
})
export class HealthModule {}
