import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { App } from './App';
import { installFakeModelContext } from './testing/fakeModelContext';
import type { CartLine, Order, Product } from './types';

const catalog: Product[] = [
  { id: 'red-shirt-basic', name: 'Basic Red Shirt', category: 'shirts', color: 'red', price: 19.99, sizes: ['S', 'M'] },
  { id: 'black-hat', name: 'Black Hat', category: 'hats', color: 'black', price: 24.99, sizes: ['one size'] },
];

// A tiny in-memory copy of the shop's API, so the pages run without a server.
function fakeApi() {
  const lines: CartLine[] = [];
  const orders: Order[] = [];
  const summary = () => ({ items: [...lines], total: lines.reduce((sum, l) => sum + l.price * l.quantity, 0) });
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

  return vi.fn((url: string, options: RequestInit = {}) => {
    const body = options.body ? (JSON.parse(String(options.body)) as Record<string, string>) : {};
    if (url.startsWith('/api/products')) {
      const query = new URL(url, 'http://shop').searchParams.get('query') ?? '';
      return Promise.resolve(json(catalog.filter((p) => `${p.name} ${p.color}`.toLowerCase().includes(query))));
    }
    if (url === '/api/cart' && options.method === 'POST') {
      const product = catalog.find((p) => p.id === body.productId)!;
      lines.push({ productId: product.id, size: body.size!, quantity: 1, name: product.name, price: product.price });
      return Promise.resolve(json(summary()));
    }
    if (url === '/api/cart') return Promise.resolve(json(summary()));
    if (url === '/api/checkout') {
      const order = { id: '1001', name: body.name!, email: body.email!, address: body.address!, ...summary() };
      orders.push(order);
      lines.length = 0;
      return Promise.resolve(json(order));
    }
    const order = orders.find((o) => url === `/api/orders/${o.id}`);
    return Promise.resolve(order ? json(order) : json({ error: 'Order not found.' }, 404));
  });
}

beforeEach(() => vi.stubGlobal('fetch', fakeApi()));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderApp(path = '/') {
  render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
}

test('search narrows the product list', async () => {
  const user = userEvent.setup();
  renderApp();
  expect(await screen.findByText('2 products, cheapest first')).toBeTruthy();

  await user.type(screen.getByLabelText('Search'), 'hat');
  await user.click(screen.getByRole('button', { name: 'Search' }));
  expect(await screen.findByText('1 products, cheapest first')).toBeTruthy();
});

test('add to cart, check out and see the order', async () => {
  const user = userEvent.setup();
  renderApp();

  await user.selectOptions(await screen.findByLabelText('Size for Basic Red Shirt'), 'M');
  const [addButton] = screen.getAllByRole('button', { name: 'Add to cart' });
  await user.click(addButton!);
  expect(await screen.findByText('Added to cart')).toBeTruthy();
  expect(document.querySelector('#cart-count')?.textContent).toBe('1');

  await user.click(screen.getByRole('link', { name: /Cart/ }));
  expect(await screen.findByText('Total €19.99')).toBeTruthy();

  await user.type(screen.getByLabelText('Full name'), 'Jane Doe');
  await user.type(screen.getByLabelText('Email'), 'jane@example.com');
  await user.type(screen.getByLabelText('Shipping address'), 'Hauptstr. 1, Düsseldorf');
  await user.click(screen.getByRole('button', { name: 'Place order' }));

  expect(await screen.findByRole('heading', { name: 'Order placed #1001' })).toBeTruthy();
  expect(screen.getByText('1 x Basic Red Shirt (M)')).toBeTruthy();
  expect(document.querySelector('#cart-count')?.textContent).toBe('0');
});

test('an unknown order shows the error', async () => {
  renderApp('/order/9999');
  expect(await screen.findByRole('heading', { name: 'Order not found.' })).toBeTruthy();
});

describe('WebMCP tools', () => {
  let webmcp: ReturnType<typeof installFakeModelContext>;
  beforeEach(() => {
    webmcp = installFakeModelContext();
  });
  afterEach(() => webmcp.uninstall());

  test('the shop page tools go away when you leave, the app tools stay', async () => {
    renderApp();
    expect(await screen.findByText('2 products, cheapest first')).toBeTruthy();
    expect(webmcp.names()).toEqual(['add_to_cart', 'get_cart', 'search_products']);
    expect(webmcp.tool('search_products')?.annotations?.readOnlyHint).toBe(true);

    await userEvent.setup().click(screen.getByRole('link', { name: /Cart/ }));
    expect(await screen.findByText('Your cart')).toBeTruthy();
    expect(webmcp.names()).toEqual(['get_cart']);
  });

  test('search_products returns matches and shows them on the page', async () => {
    renderApp();
    await screen.findByText('2 products, cheapest first');

    let result = '';
    await act(async () => {
      result = String(await webmcp.run('search_products', { query: 'hat', maxPrice: 30 }));
    });

    const data = JSON.parse(result) as { count: number; products: Product[] };
    expect(data.count).toBe(1);
    expect(data.products[0]?.id).toBe('black-hat');
    expect(await screen.findByText('1 products, cheapest first')).toBeTruthy();
    expect((screen.getByLabelText('Search') as HTMLInputElement).value).toBe('hat');
  });

  test('search_products returns an error the agent can read when maxPrice is not a number', async () => {
    renderApp();
    await screen.findByText('2 products, cheapest first');
    const result = JSON.parse(String(await webmcp.run('search_products', { maxPrice: Number.NaN }))) as { error: string };
    expect(result.error).toContain('maxPrice must be a number');
  });

  test('add_to_cart puts the item in the cart and updates the header count', async () => {
    renderApp();
    await screen.findByText('2 products, cheapest first');

    let result = '';
    await act(async () => {
      result = String(await webmcp.run('add_to_cart', { productId: 'red-shirt-basic', size: 'M' }));
    });

    const cart = JSON.parse(result) as { items: CartLine[]; total: number };
    expect(cart.items.map((item) => `${item.productId}:${item.size}`)).toEqual(['red-shirt-basic:M']);
    expect(cart.total).toBe(19.99);
    expect(document.querySelector('#cart-count')?.textContent).toBe('1');
  });

  test('get_cart returns the lines and the total, and opens the cart page', async () => {
    renderApp();
    await screen.findByText('2 products, cheapest first');
    await act(async () => {
      await webmcp.run('add_to_cart', { productId: 'black-hat', size: 'one size' });
    });

    const cart = JSON.parse(String(await webmcp.run('get_cart'))) as { items: CartLine[]; total: number };
    expect(cart.items.map((item) => item.productId)).toEqual(['black-hat']);
    expect(cart.total).toBe(24.99);
    expect(await screen.findByRole('heading', { name: 'Your cart' })).toBeTruthy();
  });
});
