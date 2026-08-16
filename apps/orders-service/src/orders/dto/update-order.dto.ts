import { OrderStatus } from '../entities/order.entity';

export class UpdateOrderStatusDto {
  id: string;
  status: OrderStatus;
}
