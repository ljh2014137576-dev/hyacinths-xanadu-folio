import type { CreateOrderInput, Order } from '../domain/order.types.js';
import { createOrder } from '../controllers/order.controller.js';

export async function unrelatedInboundCaller(input: CreateOrderInput): Promise<Order> {
  return createOrder(input, { charge: () => Promise.resolve() });
}
