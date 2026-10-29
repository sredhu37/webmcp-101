# Demo Shop

A small React clothing shop (Vite, TypeScript, React Router). `main` has no WebMCP tools; each `webmcp` branch adds one (see the root README).

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
| `src/webmcp/` | `useWebMCPTool` registers a tool while a component is mounted; `tools.ts` holds each tool's name, description and schema; `ShopTools.tsx` registers the tools that belong to no page. |
| `suite.yaml` | Scenarios for the WebMCP comparer, one per tool. |

The API:

| Method and path | Body or query | Returns |
| --- | --- | --- |
| `GET /api/products` | `?query=red shirt&maxPrice=30` | Matching products, cheapest first |
| `GET /api/cart` | | `{ items, total }` |
| `POST /api/cart` | `{ productId, size }` | The updated cart, or `400` for an unknown product or size |
| `POST /api/checkout` | `{ name, email, address }` | The order, and the cart is emptied |
| `GET /api/orders/:id` | | The order |

## WebMCP tools

Tools run in the page, so they call the same functions in `src/shop.ts` that the buttons call, and the page shows what they did. They use the imperative API: `document.modelContext.registerTool()`. A tool that changes a page's UI is registered by that page, and the cleanup in `useWebMCPTool` unregisters it when you leave. Tools that need no page are registered once in `src/webmcp/ShopTools.tsx`.

| Tool | Registered on | Does |
| --- | --- | --- |
| `search_products` | `/` | Searches the catalog by words and max price, and fills in the search form. Read-only. |
| `add_to_cart` | `/` | Adds one product in one size to the cart and updates the cart count in the header. |
| `get_cart` | every page | Returns the cart lines and total. Read-only. |

A tool that fails returns `{ "error": "..." }` as its result. Chrome tells the agent only "invocation failed" when a tool throws, so the message would be lost.

To try the tools, open the shop in Chrome with `chrome://flags/#enable-webmcp-testing` enabled, then use the Model Context Tool Inspector extension or the comparer.
