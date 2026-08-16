import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AddressModule } from './addresses/address.module';
import { HealthModule } from '@app/common';
import { userDataSourceOptions } from './data-source';

@Module({
  imports: [
    HealthModule,
    TypeOrmModule.forRoot(userDataSourceOptions),
    AddressModule,
  ],
})
export class UserServiceModule {}
