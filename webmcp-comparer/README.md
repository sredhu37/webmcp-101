# webMCP-comparer

Part of the [webmcp-101](https://github.com/sredhu37/webmcp-101) repo. The shop to compare lives in [`../app`](../app); run it on http://localhost:4000, then start the comparer.

[![Buy me a coffee on Ko-fi](https://img.shields.io/badge/Buy%20me%20a%20coffee-Ko--fi-FF5E5B?logo=kofi&logoColor=white)](https://ko-fi.com/sunnyredhu)

Runs the same Scenario on the same website in two Lanes side by side, a Baseline lane without WebMCP and a WebMCP lane with the site's WebMCP tools, and compares time, Steps, tokens, cost, tool calls and screenshots. See [docs/spec.md](docs/spec.md), [ARCHITECTURE.md](ARCHITECTURE.md) and [GLOSSARY.md](GLOSSARY.md).

## Quickstart

Needs Node 24 or newer. [`just`](https://github.com/casey/just) is optional; every recipe wraps an npm script.

| npm                                             | just                | What it does                                    |
| ----------------------------------------------- | ------------------- | ----------------------------------------------- |
| `npm ci && npx playwright install chromium`     | `just install`      | Install dependencies and Chromium               |
| `npm run dev`                                   | `just dev`          | App on :3000, live reload                       |
| `npm start`                                     | `just start`        | Production build, then the app on :3000         |
| `npm run lint && npm run typecheck && npm test` | `just check`        | Lint, typecheck and test                        |
| `npm run prices:check`                          | `just prices-check` | Compare the price table with the official pages |
| `npm run live-check`                            | `just live-check`   | One tiny real call per model (needs a key)      |

Then open http://localhost:3000. Setup is prefilled with the Site URL http://localhost:4000 and the Suite in [`../app/suite.yaml`](../app/suite.yaml); without that file it shows a one-Scenario placeholder.

API keys can be pasted in the UI or put in `.env` (copy `.env.example`).

`npm run live-check` makes one small call per model (effort medium, with a screenshot in a tool result) and prints the usage each provider reports. It uses the keys in the environment or `.env`, skips models without a key, and makes no calls when there is none. Name models to check only those: `npm run live-check -- claude-haiku-5-5`.

## Writing a Suite

A Suite is YAML with one list, `scenarios`. Each Scenario needs an `id` (lowercase, dashes) and a `prompt`; `path` (a start page on the Site URL) and `success` (checks) are optional. The Site URL, model, Repeat and limits are set in the UI, not in the file.

```yaml
scenarios:
  - id: first-open-todo
    prompt: Which to-do is first in the list?
    success:
      - answerContains: Water the plants
  - id: create-from-new-page
    path: /new
    prompt: Create a to-do called Call the bank.
    success:
      - script: "todos.list().some(t => t.title === 'Call the bank')"
```

Checks: `urlContains`, `textVisible`, `elementExists` (CSS selector), `script` (JS expression that must return `true`) and `answerContains` (the agent's `finish` answer). All must pass. Without `success`, the agent's own `finish(success)` decides.

**Write checks about the outcome, not the route.** The WebMCP lane often finishes without visiting the pages a Baseline agent clicks through: a tool like `add_todo` changes the data and stays on the current page. A check like `urlContains: /done` would fail it unfairly; check the data instead.

## Reading results

Results compares raw values side by side, Baseline against WebMCP, per Run and per Scenario: time, Steps (model calls), tokens, cost, tool calls and screenshots. Lower is shown green and higher red. Each Lane ends Pass, or Fail with a reason: `check failed: <check>`, `agent reported failure`, `step limit`, `time limit`, `cost limit`, `did not call finish`, `stopped by user` or `error: <message>`. Metrics are recorded for failed Lanes too. With Repeat above 1, values are averages with min, max and pass rate. The same numbers are in `runs/<start-time>/results.json`.

## Known limits

- Cost is approximate. Screenshot tokens are estimated, since neither provider reports them separately.
- Only WebMCP tools on the main page are used; tools inside iframes are ignored.
- The $ limit is checked after each Step, so a Lane can overshoot it by one Step.
- WebMCP is experimental in Chromium (`--enable-features=WebMCP`); its behaviour may change between Playwright versions.
- No Docker image and no command-line mode in v1.

## Test fixture

[`test/fixture/`](test/fixture) is a test-only to-do page, not something to compare. It registers two WebMCP tools (`add_todo`, `list_todos`) and a declarative `create_todo` form on `/new`, and exposes `window.todos.list()` for `script` checks. [`test/fixture/suite.yaml`](test/fixture/suite.yaml) is its Suite. `server/testing/fixture-site.ts` serves it on a random port for the integration tests.

## Prices

Cost is approximate: token buckets times the rates in [`server/pricing/prices.json`](server/pricing/prices.json), a dated copy of the official pricing pages (USD per million tokens). To use other rates, for example a negotiated discount, create `~/.webmcp-comparer/prices.json` with only the values to change; it is deep merged over the bundled table:

```json
{
  "providers": {
    "anthropic": {
      "models": { "claude-haiku-5-5": { "tiers": { "standard": { "rates": { "input": 0.08 } } } } }
    }
  }
}
```

`npm run prices:check` compares the bundled table with the official pricing pages and prints every difference. It never writes files; update `prices.json` by hand.

## UI

One page on http://localhost:3000: Past Runs in the sidebar, then Setup, Live and Results. The Suite editor is Monaco, bundled locally, and validates with the same parser as the server. Live follows the Run over `GET /api/live`: both Lanes' screens, Step meters, a scoreboard (lower value green, higher red) and each Lane's tool-call log, newest first, with WebMCP tools marked. Results shows the Run summary as paired bars per metric and every Scenario collapsed to its Pass/Fail per Lane; with Attempts > 1 it shows averages with min, max and pass rate. Opening a past Run shows each Lane's last screenshot in Live.

`server/web-ui.test.ts` boots a production build in headless Chromium and runs a real Run on the test fixture with a scripted model; `UI_SCREENSHOT_DIR=docs/screenshots npx vitest run server/web-ui.test.ts` also refreshes the screenshots of [Setup](docs/screenshots/setup.png), [Live](docs/screenshots/live.png) and [Results](docs/screenshots/results.png).

## Runs

Each Run writes `runs/<start-time>/` (git-ignored): `results.json`, and a `baseline/` and a `webmcp/` folder, each with its Lane's `log.jsonl` and the agent's screenshots. `results.json` is rewritten after every Attempt, so an interrupted Run keeps its finished Attempts. API keys stay in server memory; `results.json` and the logs pass a redaction step.

The app server's HTTP API:

| Request                                     | What it does                                                                        |
| ------------------------------------------- | ----------------------------------------------------------------------------------- |
| `GET /api/defaults`                         | Prefilled Site URL, default Suite, model, Attempts and limits                       |
| `GET /api/models`                           | The model lists with their labels and the default per provider                      |
| `GET /api/keys`                             | Whether a key is set in `.env` or pasted this session, per provider (never the key) |
| `POST /api/preflight`                       | Pre-Run checks: the key check and the WebMCP tools on each selected start page      |
| `POST /api/runs`                            | Check the key and start a Run (409 while one is going)                              |
| `GET /api/runs`                             | Past Runs, newest first                                                             |
| `GET /api/runs/:id`                         | A Run's `results.json` (live while it runs)                                         |
| `POST /api/runs/:id/stop`                   | Stop Run                                                                            |
| `GET /api/runs/:id/zip`                     | The Run folder as a zip                                                             |
| `GET /api/runs/:id/:lane/screenshots/:file` | One agent screenshot                                                                |
| `GET /api/live` (WebSocket)                 | Live view: both Lanes' screens and live metrics                                     |

`POST /api/preflight` and `POST /api/runs` take `{ siteUrl, suite, scenarioIds, model, apiKey?, attempts?, limits? }`, where `suite` is the YAML text and `limits` is `{ maxSteps, maxDurationMs, maxCostUsd }`. A pasted `apiKey` overrides `.env` for the rest of the server session once it passes the key check.

`GET /api/live` streams each Lane's screen (Playwright screencast, JPEG, at most 10 fps per Lane) as binary messages of 1 Lane byte (0 Baseline, 1 WebMCP) plus the JPEG, and the live metrics as JSON messages. A new viewer first gets the current Run state and the last frame of each Lane. The message types live in `server/live/protocol.ts`; `web/src/live/client.ts` is the browser client.
