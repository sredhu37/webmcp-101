import { useEffect, useRef, useState } from 'react';
import type { SyntheticEvent } from 'react';
import { useCartCount } from '../CartProvider';
import { formatPrice } from '../format';
import { ProductImage } from '../ProductImage';
import { addToCart, searchProducts } from '../shop';
import type { Product } from '../types';
import { addToCartTool, searchProductsTool } from '../webmcp/tools';
import { useWebMCPTool } from '../webmcp/useWebMCPTool';

function ProductCard({ product }: { product: Product }) {
  const { refresh } = useCartCount();
  const [status, setStatus] = useState('');

  async function add(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    const size = String(new FormData(event.currentTarget).get('size'));
    try {
      await addToCart(product.id, size);
      setStatus('Added to cart');
      await refresh();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Something went wrong.');
    }
  }

  return (
    <article className="card">
      <ProductImage product={product} />
      <h2>{product.name}</h2>
      <p className="price">{formatPrice(product.price)}</p>
      <p className="muted">
        {product.color} · {product.category}
      </p>
      <form className="add" onSubmit={add}>
        <select name="size" aria-label={`Size for ${product.name}`}>
          {product.sizes.map((size) => (
            <option key={size}>{size}</option>
          ))}
        </select>
        <button type="submit">Add to cart</button>
      </form>
      <p className="status" role="status">
        {status}
      </p>
    </article>
  );
}

type Filters = { query: string; maxPrice: string };

export function ShopPage() {
  const { refresh } = useCartCount();
  const [filters, setFilters] = useState<Filters>({ query: '', maxPrice: '' });
  const [products, setProducts] = useState<Product[] | null>(null);
  const latestSearch = useRef(0);

  // Shows the filters in the form, then the products they match. Used by the form and the tool.
  async function runSearch(next: Filters) {
    const search = ++latestSearch.current;
    setFilters(next);
    const found = await searchProducts(next);
    if (search === latestSearch.current) setProducts(found);
    return found;
  }

  useEffect(() => {
    void runSearch({ query: '', maxPrice: '' });
  }, []);

  useWebMCPTool(searchProductsTool, async ({ query, maxPrice }: { query?: string; maxPrice?: number }) => {
    if (maxPrice !== undefined && !Number.isFinite(maxPrice)) {
      throw new Error('maxPrice must be a number in EUR, for example 30.');
    }
    const found = await runSearch({ query: query ?? '', maxPrice: maxPrice === undefined ? '' : String(maxPrice) });
    return JSON.stringify({ count: found.length, products: found });
  });

  useWebMCPTool(addToCartTool, async ({ productId, size }: { productId: string; size: string }) => {
    const cart = await addToCart(productId, size);
    await refresh();
    return JSON.stringify(cart);
  });

  function search(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    void runSearch(filters);
  }

  return (
    <main>
      <h1>Clothes, shoes and hats</h1>
      <form id="search" role="search" onSubmit={search}>
        <input
          name="query"
          type="search"
          placeholder="Search, e.g. red shirt"
          aria-label="Search"
          value={filters.query}
          onChange={(event) => setFilters({ ...filters, query: event.target.value })}
        />
        <input
          name="maxPrice"
          type="number"
          min="0"
          step="0.01"
          placeholder="Max price"
          aria-label="Max price in EUR"
          value={filters.maxPrice}
          onChange={(event) => setFilters({ ...filters, maxPrice: event.target.value })}
        />
        <button type="submit">Search</button>
      </form>
      <p id="result-count" className="muted">
        {products && `${products.length} products, cheapest first`}
      </p>
      <div id="products" className="grid">
        {products?.map((product) => <ProductCard key={product.id} product={product} />)}
      </div>
    </main>
  );
}
