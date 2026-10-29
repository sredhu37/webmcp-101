// Every call the shop makes to its API. The buttons and forms on the pages use these functions.
import type { Cart, CheckoutDetails, Order, Product } from './types';

async function request<T>(url: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(url, {
    ...options,
    headers: { 'Content-Type': 'application/json' },
  });
  const body = (await response.json()) as T & { error?: string };
  if (!response.ok) throw new Error(body.error);
  return body;
}

export function searchProducts({ query = '', maxPrice = '' } = {}): Promise<Product[]> {
  const params = new URLSearchParams({ query, maxPrice });
  return request(`/api/products?${params}`);
}

export function getCart(): Promise<Cart> {
  return request('/api/cart');
}

export function addToCart(productId: string, size: string): Promise<Cart> {
  return request('/api/cart', { method: 'POST', body: JSON.stringify({ productId, size }) });
}

export function checkout(details: CheckoutDetails): Promise<Order> {
  return request('/api/checkout', { method: 'POST', body: JSON.stringify(details) });
}

export function getOrder(id: string): Promise<Order> {
  return request(`/api/orders/${id}`);
}
