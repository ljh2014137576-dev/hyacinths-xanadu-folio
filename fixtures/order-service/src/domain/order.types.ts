export interface OrderItemInput {
  sku: string;
  quantity: number;
}

export interface CreateOrderInput {
  customerId: string;
  paid: boolean;
  items: OrderItemInput[];
}

export interface Product {
  sku: string;
  price: number;
}

export interface Order {
  id: string;
  customerId: string;
  paid: boolean;
  items: Product[];
  total: number;
  status: 'PENDING' | 'AWAITING_PAYMENT' | 'READY_TO_SHIP';
}
