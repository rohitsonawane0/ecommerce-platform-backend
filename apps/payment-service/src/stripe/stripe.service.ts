import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import Stripe from 'stripe';
import { PaymentsService } from '../payments/payments.service';
import { CreateStripeDto } from './dto/create-stripe.dto';

@Injectable()
export class StripeService {
  private readonly logger = new Logger(StripeService.name);
  private stripe: Stripe.Stripe;
  constructor() {
    this.stripe = new Stripe(process.env.STRIPE_KEY!);
  }
  async createCheckoutSession(order: any) {
    this.logger.log(`createCheckoutSession() for order ${order.id}`);

    // Build line_items from order items (multi-product support)
    const lineItems = order.items.map((item) => ({
      price_data: {
        currency: 'usd',
        product_data: { name: item.productName },
        unit_amount: Math.round(Number(item.price) * 100), // cents
      },
      quantity: item.quantity,
    }));
    // console.log({ lineItems });
    const session = await this.stripe.checkout.sessions.create({
      line_items: lineItems,
      payment_intent_data: {
        metadata: {
          orderId: order.id,
          userId: order.userId,
        },
      },
      mode: 'payment',
      success_url: `http://localhost:4000/orders/${order.id}?payment=success`,
      cancel_url: `http://localhost:4000/orders/${order.id}?payment=cancelled`,
    });

    return { url: session.url, sessionId: session.id };
  }
}
