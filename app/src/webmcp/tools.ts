// What the shop tells agents about each tool: name, description, input schema, hints.
// The code that runs a tool lives in the page that owns it.

export const searchProductsTool = {
  name: 'search_products',
  description:
    'Search the shop catalog. Every word in the query must match the product name, category or color. Returns matching products, cheapest first, with id, price in EUR and available sizes. The shop page shows the same results.',
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Words to look for, for example "red shirt". Leave empty for all products.' },
      maxPrice: { type: 'number', description: 'Highest price in EUR.' },
    },
  },
  annotations: { readOnlyHint: true },
} as const satisfies Omit<WebMCP.ModelContextTool, 'execute'>;

export const addToCartTool = {
  name: 'add_to_cart',
  description:
    'Add one item to the shopping cart. Get the product id and the available sizes from search_products first. Returns the updated cart with its total in EUR. The cart count in the page header updates.',
  inputSchema: {
    type: 'object',
    properties: {
      productId: { type: 'string', description: 'The id of the product, for example "blue-sneakers".' },
      size: { type: 'string', description: 'One of the sizes listed for the product, for example "M" or "42". Hats use "one size".' },
    },
    required: ['productId', 'size'],
  },
} as const satisfies Omit<WebMCP.ModelContextTool, 'execute'>;

export const getCartTool = {
  name: 'get_cart',
  description:
    'Get what is in the shopping cart: each line with product, size, quantity and price, and the total in EUR. Opens the cart page, so the shop page tools (search_products, add_to_cart) are unavailable until you are back on the shop page.',
  inputSchema: { type: 'object', properties: {} },
  annotations: { readOnlyHint: true },
} as const satisfies Omit<WebMCP.ModelContextTool, 'execute'>;
