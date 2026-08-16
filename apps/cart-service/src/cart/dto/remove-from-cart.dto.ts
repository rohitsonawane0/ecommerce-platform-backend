import { IsUUID } from 'class-validator';

export class RemoveFromCartDto {
  @IsUUID()
  userId: string;

  @IsUUID()
  cartItemId: string;
}
