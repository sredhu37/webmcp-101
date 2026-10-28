// Every call the shop makes to its API. The buttons on the pages use these functions.

async function request(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { 'Content-Type': 'application/json' },
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error);
  return body;
}

export function searchProducts({ query = '', maxPrice = '' } = {}) {
  const params = new URLSearchParams({ query, maxPrice });
  return request(`/api/products?${params}`);
}

export function getCart() {
  return request('/api/cart');
}

export function addToCart(productId, size) {
  return request('/api/cart', { method: 'POST', body: JSON.stringify({ productId, size }) });
}

export function checkout({ name, email, address }) {
  return request('/api/checkout', { method: 'POST', body: JSON.stringify({ name, email, address }) });
}

export function getOrder(id) {
  return request(`/api/orders/${id}`);
}
