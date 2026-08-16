import { IsNotEmpty, IsOptional, IsUUID } from 'class-validator';

export class CreateOrderDto {
  @IsUUID()
  @IsNotEmpty()
  shippingAddressId: string;

  @IsUUID()
  @IsOptional()
  billingAddressId?: string;
}
