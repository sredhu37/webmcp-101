export type Product = {
  id: string;
  name: string;
  category: 'shirts' | 'shoes' | 'hats' | 'sweaters';
  color: string;
  price: number;
  sizes: string[];
};

export type CartLine = {
  productId: string;
  size: string;
  quantity: number;
  name: string;
  price: number;
};

export type Cart = { items: CartLine[]; total: number };

export type Order = Cart & { id: string; name: string; email: string; address: string };

export type CheckoutDetails = { name: string; email: string; address: string };
