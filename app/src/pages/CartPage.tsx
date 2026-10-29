import { useEffect, useState } from 'react';
import type { SyntheticEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { useCartCount } from '../CartProvider';
import { formatPrice } from '../format';
import { checkout, getCart } from '../shop';
import type { Cart } from '../types';

export function CartPage() {
  const navigate = useNavigate();
  const { refresh } = useCartCount();
  const [cart, setCart] = useState<Cart | null>(null);
  const [status, setStatus] = useState('');

  useEffect(() => {
    let current = true;
    void getCart().then((loaded) => {
      if (current) setCart(loaded);
    });
    return () => {
      current = false;
    };
  }, []);

  async function placeOrder(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      const order = await checkout({
        name: String(form.get('name')),
        email: String(form.get('email')),
        address: String(form.get('address')),
      });
      await refresh();
      void navigate(`/order/${order.id}`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Something went wrong.');
    }
  }

  return (
    <main className="narrow">
      <h1>Your cart</h1>
      <div id="cart">
        {cart && cart.items.length === 0 && (
          <p className="muted">
            Your cart is empty. <Link to="/">Keep shopping</Link>.
          </p>
        )}
        {cart && cart.items.length > 0 && (
          <>
            <table>
              <thead>
                <tr>
                  <th>Product</th>
                  <th>Size</th>
                  <th>Qty</th>
                  <th>Price</th>
                </tr>
              </thead>
              <tbody>
                {cart.items.map((item) => (
                  <tr key={`${item.productId}-${item.size}`}>
                    <td>{item.name}</td>
                    <td>{item.size}</td>
                    <td>{item.quantity}</td>
                    <td>{formatPrice(item.price * item.quantity)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="total">Total {formatPrice(cart.total)}</p>
          </>
        )}
      </div>
      {cart && cart.items.length > 0 && (
        <section id="checkout-section">
          <h2>Checkout</h2>
          <form id="checkout" onSubmit={placeOrder}>
            <label htmlFor="name">Full name</label>
            <input id="name" name="name" autoComplete="name" required />
            <label htmlFor="email">Email</label>
            <input id="email" name="email" type="email" autoComplete="email" required />
            <label htmlFor="address">Shipping address</label>
            <input id="address" name="address" autoComplete="street-address" required />
            <button type="submit">Place order</button>
            <p className="status" role="status">
              {status}
            </p>
          </form>
        </section>
      )}
    </main>
  );
}
