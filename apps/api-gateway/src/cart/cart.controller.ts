import { CART_SERVICE, CART_MESSAGES, CurrentUser } from '@app/common';
import type { JwtPayload } from '@app/common';
import { Controller, Get, Post, Body, Param, Delete, Inject } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { firstValueFrom } from 'rxjs';

@Controller('cart')
export class CartController {
  constructor(@Inject(CART_SERVICE) private client: ClientProxy) {}

  @Post('items')
  create(@Body() dto: any, @CurrentUser() user: JwtPayload) {
    return firstValueFrom(
      this.client.send(CART_MESSAGES.ADD_TO_CART, { ...dto, userId: user.id }),
    );
  }

  @Get()
  getMyCart(@CurrentUser() user: JwtPayload) {
    return firstValueFrom(
      this.client.send(CART_MESSAGES.GET_CART, { userId: user.id }),
    );
  }

  @Delete(':id')
  remove(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return firstValueFrom(
      this.client.send(CART_MESSAGES.REMOVE_FROM_CART, {
        cartItemId: id,
        userId: user.id,
      }),
    );
  }
}
