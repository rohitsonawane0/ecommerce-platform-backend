import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AddressModule } from './addresses/address.module';
import { HealthModule } from '@app/common';
import { buildUserDataSourceOptions } from './data-source';
import { ConfigModule, ConfigService } from '@nestjs/config';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    HealthModule,
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        buildUserDataSourceOptions((key) => config.get<string>(key)),
    }),
    AddressModule,
  ],
})
export class UserServiceModule {}
