import { Controller, Get } from '@nestjs/common';
import { CartServiceService } from './cart-service.service';

@Controller()
export class CartServiceController {
  constructor(private readonly cartServiceService: CartServiceService) {}

  @Get()
  getHello(): string {
    return this.cartServiceService.getHello();
  }
}
