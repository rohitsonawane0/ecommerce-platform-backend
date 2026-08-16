import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { Address } from './address.entity';
import { CreateAddressDto } from './dto/create-address.dto';
import { UpdateAddressDto } from './dto/update-address.dto';
import { DefaultType } from './dto/set-default.dto';

@Injectable()
export class AddressService {
  constructor(
    @InjectRepository(Address)
    private readonly repo: Repository<Address>,
    private readonly dataSource: DataSource,
  ) {}

  async create(dto: CreateAddressDto): Promise<Address> {
    return this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(Address);
      if (dto.isDefaultShipping) {
        await repo.update(
          { userId: dto.userId, isDefaultShipping: true },
          { isDefaultShipping: false },
        );
      }
      if (dto.isDefaultBilling) {
        await repo.update(
          { userId: dto.userId, isDefaultBilling: true },
          { isDefaultBilling: false },
        );
      }
      const address = repo.create(dto);
      return repo.save(address);
    });
  }

  async list(userId: string): Promise<Address[]> {
    return this.repo.find({
      where: { userId },
      order: {
        isDefaultShipping: 'DESC',
        isDefaultBilling: 'DESC',
        updatedAt: 'DESC',
      },
    });
  }

  async get(userId: string, id: string): Promise<Address> {
    const address = await this.repo.findOne({ where: { id, userId } });
    if (!address) throw new NotFoundException('Address not found');
    return address;
  }

  async update(
    userId: string,
    id: string,
    dto: UpdateAddressDto,
  ): Promise<Address> {
    const address = await this.get(userId, id);
    return this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(Address);
      if (dto.isDefaultShipping) {
        await repo.update(
          { userId, isDefaultShipping: true },
          { isDefaultShipping: false },
        );
      }
      if (dto.isDefaultBilling) {
        await repo.update(
          { userId, isDefaultBilling: true },
          { isDefaultBilling: false },
        );
      }
      Object.assign(address, dto);
      return repo.save(address);
    });
  }

  async remove(userId: string, id: string): Promise<{ id: string }> {
    const address = await this.get(userId, id);
    await this.repo.softRemove(address);
    return { id };
  }

  async setDefault(
    userId: string,
    id: string,
    type: DefaultType,
  ): Promise<Address> {
    const address = await this.get(userId, id);
    return this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(Address);
      if (type === 'shipping') {
        await repo.update(
          { userId, isDefaultShipping: true },
          { isDefaultShipping: false },
        );
        address.isDefaultShipping = true;
      } else {
        await repo.update(
          { userId, isDefaultBilling: true },
          { isDefaultBilling: false },
        );
        address.isDefaultBilling = true;
      }
      return repo.save(address);
    });
  }

  async getForOrder(userId: string, addressId: string): Promise<Address> {
    return this.get(userId, addressId);
  }
}
