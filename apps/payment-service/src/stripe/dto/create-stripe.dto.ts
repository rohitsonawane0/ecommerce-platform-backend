import { IsNotEmpty, IsString, IsUUID } from 'class-validator';

export class CreateStripeDto {
  @IsString()
  @IsNotEmpty()
  @IsUUID()
  orderId: string;
}
