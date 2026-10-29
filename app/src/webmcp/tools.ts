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
