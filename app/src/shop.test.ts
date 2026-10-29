import { afterEach, expect, test, vi } from 'vitest';
import { addToCart, searchProducts } from './shop';

function reply(status: number, body: unknown) {
  return vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status }));
}

afterEach(() => vi.unstubAllGlobals());

test('searchProducts sends the filters as a query string', async () => {
  const fetchMock = reply(200, []);
  vi.stubGlobal('fetch', fetchMock);
  await searchProducts({ query: 'red shirt', maxPrice: '30' });
  expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/products?query=red+shirt&maxPrice=30');
});

test('a failed request throws the error message from the API', async () => {
  vi.stubGlobal('fetch', reply(400, { error: 'Size "XS" is not available.' }));
  await expect(addToCart('red-shirt-basic', 'XS')).rejects.toThrow('Size "XS" is not available.');
});
