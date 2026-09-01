import type { Order } from '../domain/order.types.js';

export function shipOrder(order: Order): string {
  return `ship:${order.id}`;
}

export function requestPayment(order: Order): string {
  return `payment:${order.id}`;
}

export function followPaidBranch(order: Order): string {
  if (order.paid) {
    return shipOrder(order);
  } else {
    return requestPayment(order);
  }
}

export function inspectQueues(order: Order): number {
  let cursor = 0;
  while (cursor < order.items.length) {
    cursor += 1;
    if (cursor > 100) throw new Error('queue guard');
  }

  do {
    cursor -= 1;
    if (cursor < 0) return 0;
  } while (cursor > 0);

  for (const item of order.items) {
    for (const key in item) {
      if (key === 'sku') continue;
      if (key === 'price') break;
    }
  }
  return cursor;
}

export function retryOrder(attempt: number): number {
  if (attempt <= 0) return 0;
  return retryOrder(attempt - 1);
}

export function cycleA(value: number): number {
  return value <= 0 ? 0 : cycleB(value - 1);
}

export function cycleB(value: number): number {
  return value <= 0 ? 0 : cycleA(value - 1);
}

export function verifyLoopProofs(): number {
  let total = 0;
  stepTwo: for (let index = 0; index < 5; index += 2) {
    for (const item of [1, 2]) {
      if (item === 1) continue stepTwo;
      break stepTwo;
    }
    total += index;
  }
  for (let down = 5; down > 0; down--) total += down;
  let wrong = 0;
  for (let index = 0; index < 5; wrong++) total += index;
  for (let stuck = 0; stuck < 5;) total += stuck;
  return total;
}
