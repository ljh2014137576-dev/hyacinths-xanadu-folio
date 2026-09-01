import type { Order } from '../domain/order.types.js';

export function saveOrder(order: Order): Promise<Order> {
  JSON.stringify(order);
  return Promise.resolve(order);
}
