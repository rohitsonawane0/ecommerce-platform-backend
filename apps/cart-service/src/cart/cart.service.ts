import { Inject, Injectable } from '@nestjs/common';
import { CreateCartDto } from './dto/create-cart.dto';
import { UpdateCartDto } from './dto/update-cart.dto';
import { RemoveFromCartDto } from './dto/remove-from-cart.dto';
import { InjectRepository } from '@nestjs/typeorm';
import { Cart } from './entities/cart.entity';
import { Repository } from 'typeorm';
import { CartItem } from './entities/cart-item.entity';
import { ClientProxy, RpcException } from '@nestjs/microservices';
import { PRODUCT_SERVICE, PRODUCT_MESSAGES } from '@app/common';
import { firstValueFrom } from 'rxjs';
@Injectable()
export class CartService {
  constructor(
    @InjectRepository(Cart) private readonly cartRepository: Repository<Cart>,
    @InjectRepository(CartItem)
    private readonly cartItemRepository: Repository<CartItem>,
    @Inject(PRODUCT_SERVICE) private readonly productClient: ClientProxy,
  ) {}
  async create(createCartDto: CreateCartDto) {
    const isCartExist = await this.findByUserId(createCartDto.userId);
    if (isCartExist) {
      return isCartExist;
    }
    const cart = this.cartRepository.create({ userId: createCartDto.userId });
    return this.cartRepository.save(cart);
  }

  findAll() {
    return `This action returns all cart`;
  }

  async findOne(id: string) {
    return this.cartRepository.findOneBy({ id });
  }

  update(id: number, updateCartDto: UpdateCartDto) {
    return `This action updates a #${id} cart`;
  }

  remove(id: number) {
    return `This action removes a #${id} cart`;
  }
  async findByUserId(userId: string) {
    return this.cartRepository.findOne({
      where: { userId },
      relations: ['items'],
    });
  }

  //getCart
  async getMyCart(userId: string) {
    const cart = await this.findByUserId(userId);
    if (!cart) {
      throw new RpcException({
        statusCode: 404,
        message: 'Cart item not found',
      });
    }
    return cart;
  }
  //addTocart
  async addToCart(
    productId: string,
    cartId: string | undefined,
    quantity: number,
    userId: string,
  ) {
    if (cartId) {
      const existing = await this.getcartById(cartId);
      if (!existing) {
        throw new RpcException({
          statusCode: 404,
          message: 'Cart not found',
        });
      }
    } else {
      const cart = await this.create({ userId });
      cartId = cart.id;
    }
    // console.log({ cartId });
    //find product
    const foundProduct = await this.findProduct(productId);

    //in cart if product exist then chage quantity else set product with quantity

    const updatecartItem = await this.updateCartItems(
      cartId,
      productId,
      quantity,
      foundProduct.name,
      foundProduct.price,
    );

    return this.cartRepository.findOne({
      where: { id: cartId },
      relations: ['items'],
    });
  }

  async clearCart(userId: string) {
    const cart = await this.findByUserId(userId);
    if (!cart) {
      return { success: true, cleared: 0 };
    }
    const result = await this.cartItemRepository.delete({
      cart: { id: cart.id },
    });
    return { success: true, cleared: result.affected ?? 0 };
  }

  async removeFromCart(dto: RemoveFromCartDto) {
    const item = await this.cartItemRepository.findOne({
      where: { id: dto.cartItemId },
      relations: { cart: true },
    });
    if (!item?.cart || item.cart.userId !== dto.userId) {
      throw new RpcException({
        statusCode: 404,
        message: 'Cart item not found',
      });
    }
    await this.cartItemRepository.remove(item);
    return this.getMyCart(dto.userId);
  }

  async getcartById(cartId: string) {
    return this.findOne(cartId);
  }
  async getCartItems(cartId: string) {
    const [items, count] = await this.cartItemRepository.findAndCountBy({
      id: cartId,
    });
    return { items, count };
  }

  async updateCartItems(
    cartId: string,
    productId: string,
    quantity: number,
    productName: string = 'test product',
    productPrice: number = 100,
  ): Promise<CartItem> {
    const existing = await this.cartItemRepository.findOne({
      where: { cart: { id: cartId }, productId },
    });
    // console.log({ existing });
    if (existing) {
      existing.quantity += quantity;
      return this.cartItemRepository.save(existing);
    }
  
    const item = this.cartItemRepository.create({
      cart: { id: cartId },
      productId,
      productName,
      productPrice,
      quantity,
    });
    return this.cartItemRepository.save(item);
  }

  async findProduct(productId: string) {
    const productResponse = await firstValueFrom(
      this.productClient.send(PRODUCT_MESSAGES.FIND_ONE, { id: productId }),
    );

    if (!productResponse?.data) {
      throw new RpcException({
        statusCode: 404,
        message: 'Product not found',
      });
    }

    const foundProduct = productResponse.data;
    return foundProduct;
  }
}
