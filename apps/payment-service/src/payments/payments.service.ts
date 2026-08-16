import { Inject, Injectable } from '@nestjs/common';
import { CreatePaymentDto } from './dto/create-payment.dto';
import { UpdatePaymentDto } from './dto/update-payment.dto';
import { ClientProxy, RpcException } from '@nestjs/microservices';
import { ORDER_MESSAGES, ORDER_SERVICE } from '@app/common';
import { firstValueFrom } from 'rxjs';
import { StripeService } from '../stripe/stripe.service';

@Injectable()
export class PaymentsService {
  constructor(
    @Inject(ORDER_SERVICE) private readonly orderClient: ClientProxy,
    private readonly stripeService: StripeService,
  ) {}
  async create(createPaymentDto: CreatePaymentDto) {
    // console.log(createPaymentDto);
    const order = await firstValueFrom(
      this.orderClient.send(ORDER_MESSAGES.FIND_ONE, {
        userId: createPaymentDto.userId,
        id: createPaymentDto.orderId,
      }),
    );
    if (order.status !== 'pending') {
      throw new RpcException({ statusCode: 404, message: 'not pending' });
    }
    const stripe = await this.stripeService.createCheckoutSession(order);
    return stripe;
  }

  findAll() {
    return `This action returns all payments`;
  }

  findOne(id: number) {
    return `This action returns a #${id} payment`;
  }

  update(id: number, updatePaymentDto: UpdatePaymentDto) {
    return `This action updates a #${id} payment`;
  }

  remove(id: number) {
    return `This action removes a #${id} payment`;
  }
}
