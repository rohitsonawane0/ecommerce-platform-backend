import { PartialType, OmitType } from '@nestjs/mapped-types';
import { CreateAddressDto } from './create-address.dto';

export class UpdateAddressDto extends PartialType(
  OmitType(CreateAddressDto, ['userId'] as const),
) {}
