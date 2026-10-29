import { useEffect, useState } from 'react';
import type { SyntheticEvent } from 'react';
import { useCartCount } from '../CartProvider';
import { formatPrice } from '../format';
import { ProductImage } from '../ProductImage';
import { addToCart, searchProducts } from '../shop';
import type { Product } from '../types';

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

export function ShopPage() {
  const [filters, setFilters] = useState({ query: '', maxPrice: '' });
  const [products, setProducts] = useState<Product[] | null>(null);

  useEffect(() => {
    let current = true;
    void searchProducts(filters).then((found) => {
      if (current) setProducts(found);
    });
    return () => {
      current = false;
    };
  }, [filters]);

  function search(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setFilters({ query: String(form.get('query')), maxPrice: String(form.get('maxPrice')) });
  }

  return (
    <main>
      <h1>Clothes, shoes and hats</h1>
      <form id="search" role="search" onSubmit={search}>
        <input name="query" type="search" placeholder="Search, e.g. red shirt" aria-label="Search" />
        <input
          name="maxPrice"
          type="number"
          min="0"
          step="0.01"
          placeholder="Max price"
          aria-label="Max price in EUR"
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
