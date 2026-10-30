// Tools that do not belong to one page. They are registered once and stay while the shop is open.
import { useNavigate } from 'react-router';
import { useCartCount } from '../CartProvider';
import { checkout, getCart } from '../shop';
import type { CheckoutDetails } from '../types';
import { checkoutTool, getCartTool } from './tools';
import { useWebMCPTool } from './useWebMCPTool';

export function ShopTools() {
  const navigate = useNavigate();
  const { refresh } = useCartCount();

  useWebMCPTool(getCartTool, async () => {
    const cart = await getCart();
    void navigate('/cart');
    return JSON.stringify(cart);
  });

  useWebMCPTool(checkoutTool, async (details: CheckoutDetails) => {
    const order = await checkout(details);
    await refresh();
    void navigate(`/order/${order.id}`);
    return JSON.stringify(order);
  });

  return null;
}
