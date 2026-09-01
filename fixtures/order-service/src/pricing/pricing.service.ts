import type { CreateOrderInput, Product } from '../domain/order.types.js';

export function calculateOrderPricing(products: Product[], input: CreateOrderInput): Promise<number> {
  let total = 0;
  for (const product of products) {
    total += product.price;
  }
  return Promise.resolve(input.paid ? total : total + 5);
}
