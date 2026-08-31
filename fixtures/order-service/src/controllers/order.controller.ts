import { getProducts as loadProducts } from '../catalog/product.service.js';
import { runInTransaction } from '../db/transactions.js';
import type { CreateOrderInput, Order } from '../domain/order.types.js';
import { publishOrderCreated } from '../events/event-bus.js';
import { reserveInventory } from '../inventory/inventory.service.js';
import { processPayment, notifyCustomer } from '../payment/payment.service.js';
import { calculateOrderPricing } from '../pricing/pricing.service.js';
import { saveOrder } from '../repository/order.repository.js';
import { validateOrderInput } from '../validation/order.validator.js';
import { followPaidBranch, inspectQueues } from '../workflows/order-flow.js';

export async function createOrder(input: CreateOrderInput, gateway: { charge(order: Order): Promise<void> }): Promise<Order> {
  validateOrderInput(input);
  const products = await loadProducts(input.items);
  const total = await calculateOrderPricing(products, input);
  const order = await runInTransaction(async () => {
    await reserveInventory(products);
    const created: Order = {
      id: 'order-001',
      customerId: input.customerId,
      paid: input.paid,
      items: products,
      total,
      status: input.paid ? 'READY_TO_SHIP' : 'AWAITING_PAYMENT',
    };
    await processPayment(gateway, created);
    return saveOrder(created);
  });
  followPaidBranch(order);
  inspectQueues(order);
  notifyCustomer(order);
  publishOrderCreated(order);
  return order;
}
