import type { CreateOrderInput } from '../domain/order.types.js';

export function validateOrderInput(input: CreateOrderInput): void {
  if (input.customerId.length === 0) {
    throw new Error('customerId is required');
  }
  for (const item of input.items) {
    if (item.quantity <= 0) {
      throw new Error('quantity must be positive');
    }
  }
}
