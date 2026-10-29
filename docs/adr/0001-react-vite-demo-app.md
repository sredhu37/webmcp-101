# 0001: Demo shop is a React and Vite app

## Context

The demo shop was plain HTML and ES modules on Express. Most sites the audience builds, and most sites that will add WebMCP, are React apps. The comparer already uses React, Vite and TypeScript.

## Decision

`app/` is a React 19 single-page app built with Vite and TypeScript, routed with React Router (`/`, `/cart`, `/order/:id`). The Express server stays: it serves the API, and the pages (Vite middleware with `npm run dev`, `dist/` with `npm start`). Port 4000, the API and `suite.yaml` are unchanged.

## Consequences

- WebMCP tools are registered from components, in `useEffect` with an unregister in the cleanup. StrictMode runs effects twice in dev, so the cleanup is required.
- `npm start` builds first, so it takes a few seconds longer than before.
- The old no-build version is in git history before this change.
