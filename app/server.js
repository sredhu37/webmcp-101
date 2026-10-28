import { randomUUID } from 'node:crypto';
import express from 'express';
import { findProduct, products } from './products.js';

const port = Number(process.env.PORT ?? 4000);
const app = express();

app.use(express.json());
app.use(express.static(new URL('./public', import.meta.url).pathname, { extensions: ['html'] }));

// Every browser gets its own cart, kept in memory and found by a cookie.
const carts = new Map();
const orders = new Map();

function cartFor(req, res) {
  let id = req.headers.cookie?.match(/cartId=([\w-]+)/)?.[1];
  if (!id || !carts.has(id)) {
    id = randomUUID();
    carts.set(id, []);
    res.cookie('cartId', id, { httpOnly: true, sameSite: 'lax' });
  }
  return carts.get(id);
}

function cartSummary(items) {
  const lines = items.map((item) => {
    const product = findProduct(item.productId);
    return { ...item, name: product.name, price: product.price };
  });
  const total = lines.reduce((sum, line) => sum + line.price * line.quantity, 0);
  return { items: lines, total: Math.round(total * 100) / 100 };
}

// Search: every word must match the name, category or color. Cheapest first.
app.get('/api/products', (req, res) => {
  const words = String(req.query.query ?? '').toLowerCase().split(/\s+/).filter(Boolean);
  const maxPrice = req.query.maxPrice ? Number(req.query.maxPrice) : Infinity;
  const found = products
    .filter((p) => words.every((word) => `${p.name} ${p.category} ${p.color}`.toLowerCase().includes(word)))
    .filter((p) => p.price <= maxPrice)
    .sort((a, b) => a.price - b.price);
  res.json(found);
});

app.get('/api/cart', (req, res) => {
  res.json(cartSummary(cartFor(req, res)));
});

app.post('/api/cart', (req, res) => {
  const { productId, size, quantity = 1 } = req.body ?? {};
  const product = findProduct(productId);
  if (!product) return res.status(400).json({ error: `Unknown product "${productId}".` });
  if (!product.sizes.includes(size)) {
    return res.status(400).json({ error: `Size "${size}" is not available. Sizes: ${product.sizes.join(', ')}.` });
  }
  const items = cartFor(req, res);
  const line = items.find((item) => item.productId === productId && item.size === size);
  if (line) line.quantity += Number(quantity);
  else items.push({ productId, size, quantity: Number(quantity) });
  res.json(cartSummary(items));
});

app.post('/api/checkout', (req, res) => {
  const { name, email, address } = req.body ?? {};
  if (!name || !email || !address) return res.status(400).json({ error: 'Name, email and address are required.' });
  const items = cartFor(req, res);
  if (items.length === 0) return res.status(400).json({ error: 'The cart is empty.' });

  const order = { id: String(orders.size + 1001), name, email, address, ...cartSummary(items) };
  orders.set(order.id, order);
  items.length = 0;
  res.json(order);
});

app.get('/api/orders/:id', (req, res) => {
  const order = orders.get(req.params.id);
  if (!order) return res.status(404).json({ error: 'Order not found.' });
  res.json(order);
});

app.listen(port, () => console.log(`Shop on http://localhost:${port}`));
