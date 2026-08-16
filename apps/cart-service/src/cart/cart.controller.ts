import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { CART_MESSAGES } from '@app/common';
import { CartService } from './cart.service';
import { AddToCartDto } from './dto/add-to-cart.dto';
import { GetMyCartDto } from './dto/get-my-cart.dto';
import { RemoveFromCartDto } from './dto/remove-from-cart.dto';

@Controller()
export class CartController {
  constructor(private readonly cartService: CartService) {}

  @MessagePattern(CART_MESSAGES.ADD_TO_CART)
  async addToCart(@Payload() dto: AddToCartDto) {
    console.log(AddToCartDto);
    return this.cartService.addToCart(
      dto.productId,
      dto.cartId,
      dto.quantity,
      dto.userId,
    );
  }

  @MessagePattern(CART_MESSAGES.GET_CART)
  getMyCart(@Payload() dto: GetMyCartDto) {
    return this.cartService.getMyCart(dto.userId);
  }

  @MessagePattern(CART_MESSAGES.REMOVE_FROM_CART)
  removeFromCart(@Payload() dto: RemoveFromCartDto) {
    return this.cartService.removeFromCart(dto);
  }

  @MessagePattern(CART_MESSAGES.CLEAR_CART)
  clearCart(@Payload() dto: { userId: string }) {
    return this.cartService.clearCart(dto.userId);
  }
}
