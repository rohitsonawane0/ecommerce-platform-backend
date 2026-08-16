import { Module } from '@nestjs/common';
// import { PaymentsService } from './payments.service';
import { PaymentsController } from './payments.controller';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { PAYMENT_SERVICE } from '@app/common';

@Module({
  imports: [
    ClientsModule.register([
      {
        name: PAYMENT_SERVICE,
        transport: Transport.TCP,
        options: {
          host: process.env.PAYMENT_SERVICE_HOST || 'localhost',
          port: parseInt(process.env.PAYMENT_SERVICE_PORT || '3005', 10),
        },
      },
    ]),
  ],
  controllers: [PaymentsController],
  providers: [],
})
export class PaymentsModule {}
