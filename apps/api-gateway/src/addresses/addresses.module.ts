import { Module } from '@nestjs/common';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { USER_SERVICE } from '@app/common';
import { AddressesController } from './addresses.controller';

@Module({
  imports: [
    ClientsModule.register([
      {
        name: USER_SERVICE,
        transport: Transport.TCP,
        options: {
          host: process.env.USER_SERVICE_HOST || 'localhost',
          port: parseInt(process.env.USER_SERVICE_PORT || '3006', 10),
        },
      },
    ]),
  ],
  controllers: [AddressesController],
})
export class AddressesModule {}
