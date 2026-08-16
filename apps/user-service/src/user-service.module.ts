import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AddressModule } from './addresses/address.module';
import { HealthModule } from '@app/common';

@Module({
  imports: [
    HealthModule,
    TypeOrmModule.forRoot({
      type: 'postgres',
      host: process.env.USER_DB_HOST || 'localhost',
      port: parseInt(process.env.USER_DB_PORT || '5448', 10),
      username: process.env.USER_DB_USERNAME || 'postgres',
      password: process.env.USER_DB_PASSWORD || 'postgres',
      database: process.env.USER_DB_NAME || 'user_db',
      autoLoadEntities: true,
      synchronize: true,
    }),
    AddressModule,
  ],
})
export class UserServiceModule {}
