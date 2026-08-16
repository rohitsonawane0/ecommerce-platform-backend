import { IsUUID } from 'class-validator';

export class GetMyCartDto {
  @IsUUID()
  userId: string;
}
