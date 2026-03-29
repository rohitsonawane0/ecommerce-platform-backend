import { Injectable } from '@nestjs/common';

@Injectable()
export class CartServiceService {
  getHello(): string {
    return 'Hello World!';
  }
}
