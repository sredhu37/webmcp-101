# Demo Shop

A small clothing shop with no WebMCP tools. It is the starting point for adding them yourself.

```bash
npm install
npm start        # http://localhost:4000
npm run dev      # same, restarts when a server file changes
```

## How it fits together

| File | What it does |
| --- | --- |
| `server.js` | Express server: serves `public/` and the API below. Carts are kept in memory, one per browser (cookie). |
| `products.js` | The catalog: 12 products with price, colour and sizes. |
| `public/shop.js` | Every API call the shop makes: `searchProducts()`, `getCart()`, `addToCart()`, `checkout()`, `getOrder()`. |
| `public/index.js`, `cart.js`, `order.js` | The pages. Their buttons and forms call the functions in `shop.js`. |
| `suite.yaml` | Scenarios for the WebMCP comparer. |

The API:

| Method and path | Body or query | Returns |
| --- | --- | --- |
| `GET /api/products` | `?query=red shirt&maxPrice=30` | Matching products, cheapest first |
| `GET /api/cart` | | `{ items, total }` |
| `POST /api/cart` | `{ productId, size }` | The updated cart, or `400` for an unknown product or size |
| `POST /api/checkout` | `{ name, email, address }` | The order, and the cart is emptied |
| `GET /api/orders/:id` | | The order |

WebMCP tools run in the page, so a tool can call the same functions in `public/shop.js` that the buttons call.
