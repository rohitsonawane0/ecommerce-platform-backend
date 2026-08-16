import { IsIn, IsString } from 'class-validator';

export type DefaultType = 'shipping' | 'billing';

export class SetDefaultDto {
  @IsString()
  userId: string;

  @IsString()
  addressId: string;

  @IsIn(['shipping', 'billing'])
  type: DefaultType;
}
