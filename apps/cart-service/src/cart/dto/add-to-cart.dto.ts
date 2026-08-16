import { IsUUID, IsInt, Min, IsOptional } from 'class-validator';

export class AddToCartDto {
  @IsUUID()
  userId: string;

  @IsUUID()
  productId: string;

  @IsUUID()
  @IsOptional()
  cartId?: string;

  @IsInt()
  @Min(1)
  quantity: number;
}
