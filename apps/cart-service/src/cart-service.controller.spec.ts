import { Test, TestingModule } from '@nestjs/testing';
import { CartServiceController } from './cart-service.controller';
import { CartServiceService } from './cart-service.service';

describe('CartServiceController', () => {
  let cartServiceController: CartServiceController;

  beforeEach(async () => {
    const app: TestingModule = await Test.createTestingModule({
      controllers: [CartServiceController],
      providers: [CartServiceService],
    }).compile();

    cartServiceController = app.get<CartServiceController>(
      CartServiceController,
    );
  });

  describe('root', () => {
    it('should return "Hello World!"', () => {
      expect(cartServiceController.getHello()).toBe('Hello World!');
    });
  });
});
