import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { firstValueFrom } from 'rxjs';
import { ADDRESS_MESSAGES, CurrentUser, USER_SERVICE } from '@app/common';
import type { JwtPayload } from '@app/common';

@Controller('addresses')
export class AddressesController {
  constructor(@Inject(USER_SERVICE) private readonly client: ClientProxy) {}

  @Post()
  create(@Body() dto: any, @CurrentUser() user: JwtPayload) {
    console.log(dto, ADDRESS_MESSAGES.CREATE);
    return firstValueFrom(
      this.client.send(ADDRESS_MESSAGES.CREATE, { ...dto, userId: user.id }),
    );
  }

  @Get()
  list(@CurrentUser() user: JwtPayload) {
    return firstValueFrom(
      this.client.send(ADDRESS_MESSAGES.LIST, { userId: user.id }),
    );
  }

  @Get(':id')
  get(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return firstValueFrom(
      this.client.send(ADDRESS_MESSAGES.GET, { userId: user.id, id }),
    );
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: any,
    @CurrentUser() user: JwtPayload,
  ) {
    return firstValueFrom(
      this.client.send(ADDRESS_MESSAGES.UPDATE, {
        userId: user.id,
        id,
        dto,
      }),
    );
  }

  @Delete(':id')
  remove(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return firstValueFrom(
      this.client.send(ADDRESS_MESSAGES.DELETE, { userId: user.id, id }),
    );
  }

  @Post(':id/default')
  setDefault(
    @Param('id') id: string,
    @Body() body: { type: 'shipping' | 'billing' },
    @CurrentUser() user: JwtPayload,
  ) {
    return firstValueFrom(
      this.client.send(ADDRESS_MESSAGES.SET_DEFAULT, {
        userId: user.id,
        addressId: id,
        type: body.type,
      }),
    );
  }
}
