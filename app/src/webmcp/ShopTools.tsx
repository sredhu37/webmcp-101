// Tools that do not belong to one page. They are registered once and stay while the shop is open.
import { useNavigate } from 'react-router';
import { getCart } from '../shop';
import { getCartTool } from './tools';
import { useWebMCPTool } from './useWebMCPTool';

export function ShopTools() {
  const navigate = useNavigate();

  useWebMCPTool(getCartTool, async () => {
    const cart = await getCart();
    void navigate('/cart');
    return JSON.stringify(cart);
  });
  return null;
}
