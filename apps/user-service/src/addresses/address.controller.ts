import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { ADDRESS_MESSAGES } from '@app/common';
import { AddressService } from './address.service';
import { CreateAddressDto } from './dto/create-address.dto';
import { UpdateAddressDto } from './dto/update-address.dto';
import { SetDefaultDto } from './dto/set-default.dto';

@Controller()
export class AddressController {
  constructor(private readonly service: AddressService) {}
  @MessagePattern(ADDRESS_MESSAGES.CREATE)
  create(@Payload() dto: CreateAddressDto) {
    return this.service.create(dto);
  }

  @MessagePattern(ADDRESS_MESSAGES.LIST)
  list(@Payload() payload: { userId: string }) {
    return this.service.list(payload.userId);
  }

  @MessagePattern(ADDRESS_MESSAGES.GET)
  get(@Payload() payload: { userId: string; id: string }) {
    console.log(payload);
    return this.service.get(payload.userId, payload.id);
  }

  @MessagePattern(ADDRESS_MESSAGES.UPDATE)
  update(
    @Payload()
    payload: {
      userId: string;
      id: string;
      dto: UpdateAddressDto;
    },
  ) {
    return this.service.update(payload.userId, payload.id, payload.dto);
  }

  @MessagePattern(ADDRESS_MESSAGES.DELETE)
  remove(@Payload() payload: { userId: string; id: string }) {
    return this.service.remove(payload.userId, payload.id);
  }

  @MessagePattern(ADDRESS_MESSAGES.SET_DEFAULT)
  setDefault(@Payload() dto: SetDefaultDto) {
    return this.service.setDefault(dto.userId, dto.addressId, dto.type);
  }

  @MessagePattern(ADDRESS_MESSAGES.GET_FOR_ORDER)
  getForOrder(@Payload() payload: { userId: string; addressId: string }) {
    return this.service.getForOrder(payload.userId, payload.addressId);
  }
}
