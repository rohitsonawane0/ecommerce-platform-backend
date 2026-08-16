import { CurrentUser, PAYMENT_MESSAGES, PAYMENT_SERVICE } from '@app/common';
import type { JwtPayload } from '@app/common';
import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Inject,
} from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { firstValueFrom } from 'rxjs';

@Controller('payments')
export class PaymentsController {
  constructor(@Inject(PAYMENT_SERVICE) private paymentClient: ClientProxy) {}

  @Post()
  create(@CurrentUser() user: JwtPayload, @Body() createPaymentDto: any) {
    return firstValueFrom(
      this.paymentClient.send(PAYMENT_MESSAGES.CREATE, {
        userId: user.id,
        ...createPaymentDto,
      }),
    );
  }

  @Get()
  findAll() {
    return firstValueFrom(
      this.paymentClient.send(PAYMENT_MESSAGES.FIND_BY_ORDER, { id: 'hii' }),
    );
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return firstValueFrom(this.paymentClient.send('payment.findOne', +id));
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() updatePaymentDto: any) {
    return firstValueFrom(
      this.paymentClient.send('payment.update', {
        id: +id,
        data: updatePaymentDto,
      }),
    );
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return firstValueFrom(this.paymentClient.send('payment.remove', +id));
  }
}
