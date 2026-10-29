// Keeps the number shown on the header's cart link in sync with the server's cart.
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { getCart } from './shop';

type CartCount = { count: number; refresh: () => Promise<void> };

const CartCountContext = createContext<CartCount | null>(null);

export function CartProvider({ children }: { children: ReactNode }) {
  const [count, setCount] = useState(0);

  const refresh = useCallback(async () => {
    const { items } = await getCart();
    setCount(items.reduce((sum, item) => sum + item.quantity, 0));
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const value = useMemo(() => ({ count, refresh }), [count, refresh]);
  return <CartCountContext value={value}>{children}</CartCountContext>;
}

export function useCartCount(): CartCount {
  const value = useContext(CartCountContext);
  if (!value) throw new Error('useCartCount must be used inside CartProvider.');
  return value;
}
