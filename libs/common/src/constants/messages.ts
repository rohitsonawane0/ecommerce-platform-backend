export const AUTH_MESSAGES = {
  REGISTER: 'auth.register',
  LOGIN: 'auth.login',
  REFRESH: 'auth.refresh',
  LOGOUT: 'auth.logout',
  ME: 'auth.me',
  FORGOT_PASSWORD: 'auth.forgotPassword',
  RESET_PASSWORD: 'auth.resetPassword',
  VALIDATE_TOKEN: 'auth.validateToken',
} as const;
export const PRODUCT_MESSAGES = {
  CREATE: 'product.create',
  FIND_ALL: 'product.findAll',
  FIND_ONE: 'product.findOne',
  UPDATE: 'product.update',
  DELETE: 'product.delete',
  ACTIVATE: 'product.activate',
  DEACTIVATE: 'product.deactivate',
  UPDATE_STOCK: 'product.updateStock',
  CATEGORY_CREATE: 'product.category.create',
  CATEGORY_FIND_ALL: 'product.category.findAll',
  CATEGORY_FIND_ONE: 'product.category.findOne',
  CATEGORY_UPDATE: 'product.category.update',
  CATEGORY_DELETE: 'product.category.delete',
} as const;
export const CART_MESSAGES = {
  ADD_TO_CART: 'cart.addToCart',
  GET_CART: 'cart.getCart',
  REMOVE_FROM_CART: 'cart.removeFromCart',
  CLEAR_CART: 'cart.clearCart',
} as const;
export const ORDER_MESSAGES = {
  CREATE: 'order.create',
  FIND_ALL: 'order.findAll',
  FIND_ONE: 'order.findOne',
  UPDATE_STATUS: 'order.updateStatus',
  CANCEL: 'order.cancel',
} as const;

export const ADDRESS_MESSAGES = {
  CREATE: 'address.create',
  LIST: 'address.list',
  GET: 'address.get',
  UPDATE: 'address.update',
  DELETE: 'address.delete',
  SET_DEFAULT: 'address.setDefault',
  GET_FOR_ORDER: 'address.getForOrder',
} as const;

export const PAYMENT_MESSAGES = {
  CREATE: 'payment.create',
  FIND_ONE: 'payment.findOne',
  FIND_BY_ORDER: 'payment.findByOrder',
  REFUND: 'payment.refund',
  WEBHOOK: 'payment.webhook',
} as const;
