import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { firstValueFrom } from 'rxjs';
import { CurrentUser, ORDER_MESSAGES, ORDER_SERVICE } from '@app/common';
import type { JwtPayload } from '@app/common';
import { CreateOrderDto } from './dto/create-order.dto';

@Controller('orders')
export class OrdersController {
  constructor(
    @Inject(ORDER_SERVICE) private readonly orderClient: ClientProxy,
  ) {}

  @Post()
  create(@CurrentUser() user: JwtPayload, @Body() dto: CreateOrderDto) {
    return firstValueFrom(
      this.orderClient.send(ORDER_MESSAGES.CREATE, { userId: user.id, ...dto }),
    );
  }

  @Get()
  findAll(
    @CurrentUser() user: JwtPayload,
    @Query('page') page: string = '1',
    @Query('limit') limit: string = '10',
  ) {
    return firstValueFrom(
      this.orderClient.send(ORDER_MESSAGES.FIND_ALL, {
        userId: user.id,
        page: parseInt(page, 10),
        limit: parseInt(limit, 10),
      }),
    );
  }

  @Get(':id')
  findOne(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return firstValueFrom(
      this.orderClient.send(ORDER_MESSAGES.FIND_ONE, {
        userId: user.id,
        id,
      }),
    );
  }

  @Post(':id/cancel')
  cancel(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return firstValueFrom(
      this.orderClient.send(ORDER_MESSAGES.CANCEL, {
        userId: user.id,
        id,
      }),
    );
  }
}
