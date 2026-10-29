import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import { formatPrice } from '../format';
import { getOrder } from '../shop';
import type { Order } from '../types';

export function OrderPage() {
  const { id = '' } = useParams();
  const [result, setResult] = useState<{ order?: Order; error?: string } | null>(null);

  useEffect(() => {
    let current = true;
    getOrder(id).then(
      (order) => current && setResult({ order }),
      (error: unknown) =>
        current && setResult({ error: error instanceof Error ? error.message : 'Order not found.' }),
    );
    return () => {
      current = false;
    };
  }, [id]);

  const order = result?.order;
  return (
    <main className="narrow" id="order">
      {result?.error && <h1>{result.error}</h1>}
      {order && (
        <>
          <h1>Order placed #{order.id}</h1>
          <p>
            Thank you, {order.name}. A confirmation goes to {order.email}.
          </p>
          <ul>
            {order.items.map((item) => (
              <li key={`${item.productId}-${item.size}`}>
                {item.quantity} x {item.name} ({item.size})
              </li>
            ))}
          </ul>
          <p className="total">Total {formatPrice(order.total)}</p>
          <p className="muted">Shipping to {order.address}</p>
          <p>
            <Link to="/">Keep shopping</Link>
          </p>
        </>
      )}
    </main>
  );
}
