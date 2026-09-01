import type { Order } from '../domain/order.types.js';

export class EventBus {
  publish(topic: string, order: Order): string {
    return `${topic}:${order.id}`;
  }
}

export function publishOrderCreated(order: Order): string {
  const bus = new EventBus();
  return bus.publish('order.created', order);
}
