# 0002: WebMCP tools use the imperative API, registered per page

## Context

WebMCP has an imperative API (`document.modelContext.registerTool`) and a declarative one (`toolname` on forms). The spec has dropped the declarative API from its current draft. The shop is a React app, so most behaviour lives in components, not in plain forms.

## Decision

- Tools use the imperative API only.
- A component registers a tool with `useWebMCPTool`; unmounting aborts the registration. Tools that drive a page's UI (`search_products`, `add_to_cart`) are registered by that page. Tools that need no page (`get_cart`, and later `checkout`, `get_order`) are registered once for the whole app in `ShopTools`, so an agent can use them from any page.
- A tool returns a string (JSON for data). If it fails, it returns `{ "error": "..." }` instead of throwing, because Chrome shows the agent only "invocation failed" for a thrown error.
- Types come from the `webmcp-types` package (types only, from the WebMCP community group).

## Consequences

- Page tools exist only while their page is open. An agent on another page does not see them.
- StrictMode registers, aborts and registers again in dev; the hook ignores the abort error.
- The API is a draft that changes. Chrome 156 with `--enable-features=WebMCP` was the version checked.
