# Demo Shop

A small React clothing shop (Vite, TypeScript, React Router) with no WebMCP tools. It is the starting point for adding them yourself.

```bash
npm install
npm start        # builds the pages, then http://localhost:4000
npm run dev      # same port, Vite hot reload, restarts when server.js changes
npm test         # Vitest: API client and the shop flow
npm run typecheck
```

## How it fits together

| File | What it does |
| --- | --- |
| `server.js` | Express server: the API below, plus the pages (Vite in dev mode, `dist/` otherwise). Carts are kept in memory, one per browser (cookie). |
| `products.js` | The catalog: 12 products with price, colour and sizes. |
| `src/shop.ts` | Every API call the shop makes: `searchProducts()`, `getCart()`, `addToCart()`, `checkout()`, `getOrder()`. |
| `src/App.tsx` | The header and the routes: `/`, `/cart`, `/order/:id`. |
| `src/pages/` | The three pages. Their buttons and forms call the functions in `shop.ts`. |
| `src/CartProvider.tsx` | The cart count in the header. Pages call `refresh()` after the cart changes. |
| `suite.yaml` | Scenarios for the WebMCP comparer. |

The API:

| Method and path | Body or query | Returns |
| --- | --- | --- |
| `GET /api/products` | `?query=red shirt&maxPrice=30` | Matching products, cheapest first |
| `GET /api/cart` | | `{ items, total }` |
| `POST /api/cart` | `{ productId, size }` | The updated cart, or `400` for an unknown product or size |
| `POST /api/checkout` | `{ name, email, address }` | The order, and the cart is emptied |
| `GET /api/orders/:id` | | The order |

WebMCP tools run in the page, so a tool can call the same functions in `src/shop.ts` that the buttons call. In React, register a tool in a `useEffect` and unregister it in the cleanup.
