import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { PaymentsService } from './payments.service';
import { CreatePaymentDto } from './dto/create-payment.dto';
import { UpdatePaymentDto } from './dto/update-payment.dto';
import { PAYMENT_MESSAGES } from '@app/common';

@Controller()
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @MessagePattern(PAYMENT_MESSAGES.CREATE)
  create(@Payload() createPaymentDto: any) {
    console.log(createPaymentDto);
    return this.paymentsService.create(createPaymentDto);
  }

  @MessagePattern('findAllPayments')
  findAll() {
    return this.paymentsService.findAll();
  }

  @MessagePattern('findOnePayment')
  findOne(@Payload() id: number) {
    return this.paymentsService.findOne(id);
  }

  @MessagePattern('updatePayment')
  update(@Payload() updatePaymentDto: UpdatePaymentDto) {
    return this.paymentsService.update(updatePaymentDto.id, updatePaymentDto);
  }

  @MessagePattern('removePayment')
  remove(@Payload() id: number) {
    return this.paymentsService.remove(id);
  }
}
