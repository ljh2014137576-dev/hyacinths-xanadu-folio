import type { OrderItemInput, Product } from '../domain/order.types.js';

export function getProducts(items: OrderItemInput[]): Promise<Product[]> {
  return Promise.resolve(items.map((item) => ({ sku: item.sku, price: item.quantity * 12 })));
}
