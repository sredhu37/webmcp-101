import { Link, Route, Routes } from 'react-router';
import { CartProvider, useCartCount } from './CartProvider';
import { CartPage } from './pages/CartPage';
import { OrderPage } from './pages/OrderPage';
import { ShopPage } from './pages/ShopPage';

function Header() {
  const { count } = useCartCount();
  return (
    <header>
      <Link className="brand" to="/">
        Demo Shop
      </Link>
      <Link className="cart-link" to="/cart">
        Cart <span id="cart-count">{count}</span>
      </Link>
    </header>
  );
}

export function App() {
  return (
    <CartProvider>
      <Header />
      <Routes>
        <Route path="/" element={<ShopPage />} />
        <Route path="/cart" element={<CartPage />} />
        <Route path="/order/:id" element={<OrderPage />} />
        <Route path="*" element={<main className="narrow"><h1>Page not found</h1></main>} />
      </Routes>
    </CartProvider>
  );
}
