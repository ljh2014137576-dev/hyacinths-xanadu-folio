import type { Order } from '../domain/order.types.js';

export interface PaymentGateway {
  charge(order: Order): Promise<void>;
}

export async function processPayment(gateway: PaymentGateway, order: Order): Promise<void> {
  await gateway.charge(order);
}

export function sendEmail(order: Order): string {
  return `email:${order.id}`;
}

export function sendSms(order: Order): string {
  return `sms:${order.id}`;
}

export function notifyCustomer(order: Order): string {
  const notifier = order.paid ? sendEmail : sendSms;
  return notifier(order);
}

export function callDynamicGateway(gateway: unknown, order: Order): unknown {
  const execute = (gateway as { execute?: (value: Order) => unknown }).execute;
  return execute?.(order);
}
