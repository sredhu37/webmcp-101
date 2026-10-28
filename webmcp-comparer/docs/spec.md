# webMCP-comparer v1 spec

Status: ready to build. Every decision below links to the ticket that holds its reasoning on the [wayfinder map](https://github.com/sredhu37/webmcp-101/issues/1). Vocabulary follows [GLOSSARY.md](../GLOSSARY.md).

## 1. What it is

A local web app that runs the same Scenario on the same website in two Lanes at the same time and compares them:

- **Baseline lane** (left): Chrome without WebMCP, agent has Browser tools only.
- **WebMCP lane** (right): Chrome with WebMCP, agent has Browser tools plus the site's WebMCP tools.

It measures time, Steps, tokens, approximate cost, tool calls and screenshots per Lane, shows both Lanes live side by side, logs everything, and writes a structured results file per Run.

Users clone the repo and run it locally with Node. It is not deployed.

## 2. Architecture

```
 browser: http://localhost:3000
 ┌──────────────────────────────────────────────┐
 │ web/  React + Vite (Monaco for the Suite)    │
 └───────────────┬──────────────────────────────┘
                 │ HTTP: start/stop Run, list Runs, zip
                 │ WebSocket: screencast frames + live metrics
 ┌───────────────▼──────────────────────────────┐
 │ server/  Node + Fastify (also serves web/)   │
 │  ├ Run orchestrator (one Scenario at a time) │
 │  ├ Baseline lane: AI SDK loop + Chromium     │
 │  ├ WebMCP lane:   AI SDK loop + Chromium     │
 │  │                (--enable-features=WebMCP) │
 │  └ writes runs/<start-time>/                 │
 └───────────────┬──────────────────────────────┘
                 │ both Chromes open the Site URL
 ┌───────────────▼──────────────────────────────┐
 │ ../app  the shop, http://localhost:4000      │
 │ (separate server, knows nothing of the app)  │
 └──────────────────────────────────────────────┘
```

| Part | Choice | Ticket |
| --- | --- | --- |
| Frontend | React + Vite, Monaco editor | [Stack](https://github.com/sredhu37/webmcp-101/issues/11) |
| Backend | Node 24+, Fastify, one process | [Stack](https://github.com/sredhu37/webmcp-101/issues/11) |
| Agent loop | Vercel AI SDK v7 (`ai`, `@ai-sdk/anthropic`, `@ai-sdk/openai`), own outer loop calling `streamText` once per Step | [Agent loop](https://github.com/sredhu37/webmcp-101/issues/5) |
| Browser | Playwright 1.64+ Chromium, headless | [WebMCP in Playwright](https://github.com/sredhu37/webmcp-101/issues/4) |
| Live view | Playwright `page.screencast` (CDP screencast), JPEG frames over one WebSocket, one canvas per Lane | [Live view](https://github.com/sredhu37/webmcp-101/issues/3) |
| Layout | One package: `server/`, `web/`, `test/fixture/` (tests only) | [Stack](https://github.com/sredhu37/webmcp-101/issues/11) |
| Tooling | npm, TypeScript strict, Vitest, ESLint + Prettier, exact version pins | [Stack](https://github.com/sredhu37/webmcp-101/issues/11) |

## 3. Running locally

```
npm ci && npx playwright install chromium   # or: just install
npm run dev                                  # or: just dev    (app :3000, live reload)
npm start                                    # or: just start  (production build, app :3000)
```

`justfile` recipes wrap npm scripts only; `just` is optional. Recipes: `default` (list), `install`, `dev`, `start`, `check` (lint, typecheck, test), `prices-check`, `live-check`. The shop to compare (`../app`, `:4000`) is started separately. Ticket: [Local run](https://github.com/sredhu37/webmcp-101/issues/16).

## 4. Input: the Suite

A Suite is YAML containing only `scenarios`. Ticket: [Suite YAML schema](https://github.com/sredhu37/webmcp-101/issues/7).

| Field | Required | Meaning |
| --- | --- | --- |
| `id` | yes | Short, lowercase, dashes. Unique within the Suite. |
| `prompt` | yes | The task, in plain language. Both Lanes get it unchanged. |
| `path` | no | Start page as a path, appended to the Site URL. Default: the Site URL itself. |
| `success` | no | List of Success checks, all must pass. |

Validation errors (shown live with line numbers, Run disabled until valid): missing `id` or `prompt`, duplicate `id`, unknown field, invalid check.

Not in the YAML: Site URL, provider, model, limits, Attempts. Those are set in the UI.

### Success checks

Ticket: [Success check](https://github.com/sredhu37/webmcp-101/issues/6).

| Check | Passes when |
| --- | --- |
| `urlContains: <text>` | Final URL contains the text |
| `textVisible: <text>` | Visible page text contains it, case-insensitive |
| `elementExists: <css>` | The selector matches an element |
| `script: <js>` | The JS expression evaluates to `true` on the final page |
| `answerContains: <text>` | The agent's `finish` answer contains it, case-insensitive |

Checks must test the **outcome, not the route**: the WebMCP lane can finish a task without visiting the page a Baseline agent would (for example `add_to_cart` keeps the current page). With no `success`, the agent's `finish(success)` decides.

## 5. The Run

Ticket: [Run controls](https://github.com/sredhu37/webmcp-101/issues/10).

- Scenarios run **one at a time**; each Scenario's two Lanes run **in parallel**, each in its own fresh Chromium.
- **Attempts** (Repeat, UI only, default 1): each Scenario runs N times, one after another.
- **Limits per Lane per Attempt**, set in the UI only, prefilled: **50 Steps, 5 minutes, $2.00**. A Step is one model call.
- **Stop Run** ends the Run immediately: finished Scenarios are kept, the running Scenario's Lanes are Fail `stopped by user` with metrics kept, unstarted Scenarios are skipped.
- **Pre-Run key check**: one free models-list call; a bad key errors before any Lane starts.

### Lane lifecycle

```
open start URL ─▶ loop: model call (Step) ─▶ tool calls ─▶ next Step
                    │
                    ├─ finish(success, answer) ─▶ run checks (or use success) ─▶ Pass / Fail
                    ├─ text-only reply ─▶ one reminder ─▶ text-only again ─▶ Fail "did not call finish"
                    ├─ Step / time / cost limit ─▶ Fail (checks not run)
                    └─ API / browser error ─▶ Fail "error: <message>"
```

**Outcome** is Pass, or Fail with a reason: `check failed: <check>`, `agent reported failure`, `step limit`, `time limit`, `cost limit`, `did not call finish`, `stopped by user`, `error: <message>`. Metrics are recorded for every Lane whatever the Outcome.

## 6. Fairness and Lane configuration

Tickets: [Demo site](https://github.com/sredhu37/webmcp-101/issues/13), [System prompt](https://github.com/sredhu37/webmcp-101/issues/15), [Browser tools](https://github.com/sredhu37/webmcp-101/issues/17), [Iframe tools](https://github.com/sredhu37/webmcp-101/issues/14).

Identical in both Lanes: model, effort (medium), system prompt, user message, limits, viewport (1280 x 800), Browser tools.

Different:

| | Baseline lane | WebMCP lane |
| --- | --- | --- |
| Chromium flag | none | `--enable-features=WebMCP` |
| Tools | Browser tools | Browser tools + the site's main-frame WebMCP tools |

### Prompting

System prompt (fixed, versioned in one file in the repo, never mentions WebMCP, not editable in the UI):

```
You are a browser agent completing a task on a website for a user.
Use only the tools provided.

- Stay on this website. Do not open other sites.
- The user cannot answer questions. If something is unclear, make a
  reasonable choice, or finish with success = false.
- If a tool returns an error, read it and try another way.
- When the task is done, or you are sure it cannot be done, call
  finish once:
    success: true or false
    answer:  the answer, for a question; a one-line summary of what
             you did, for an action.
- Every reply must call a tool.
```

User message: `Task: <prompt>` and `You are on: <start URL>`.

Reminder (once, after a text-only reply): `You replied without calling a tool. Continue with a tool call, or call finish if you are done.`

### Browser tools

| Tool | Behaviour |
| --- | --- |
| `screenshot()` | Visible viewport, JPEG quality 70; counted as a screenshot |
| `read_page()` | Accessibility snapshot of the whole page, interactive elements carry a `ref`; cut at 30,000 characters with "(truncated)" |
| `click(target)` | Click an element |
| `type(target, text, submit?)` | Type into a field, optionally press Enter |
| `select(target, value)` | Choose a dropdown option |
| `scroll(direction)` | Scroll one screen up or down |
| `navigate(url)` | Go to a URL |
| `back()` | Browser back |
| `wait(text?)` | Wait for text to appear, or a short pause |
| `finish(success, answer)` | End the Lane; not counted as a tool call |

`target` is any one of `{ ref }` (from `read_page`), `{ selector }` (CSS) or `{ x, y }` (viewport coordinates). The log records which method each call used.

### WebMCP tools

Exposed to the agent with the name, description and input schema the site registers. Main frame only (`page.webmcp`); iframe tools are out of scope.

## 7. Models, keys and cost

Tickets: [Model and API keys](https://github.com/sredhu37/webmcp-101/issues/9), [Token usage and pricing](https://github.com/sredhu37/webmcp-101/issues/2).

| Label | Anthropic | OpenAI |
| --- | --- | --- |
| recommended (default) | Haiku 5.5 (`claude-haiku-5-5`) | `gpt-6-luna` |
| ok | Sonnet 5.5 (`claude-sonnet-5-5`) | `gpt-6.1-sol` |
| not recommended | Opus 5.5 (`claude-opus-5-5`) | `gpt-5.6-sol` |

Fixed lists, no free-text model id. Effort medium for all.

**Keys**: pasted in the UI and/or read from `.env` (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, git-ignored). A pasted key overrides `.env` for the session. Keys live in server memory only, are never sent back to the browser, and never reach a file: every line written to `log.jsonl` and `results.json` passes a redaction step, covered by a test.

**Tokens**: per Step, store the provider's raw usage plus normalized, non-overlapping buckets: uncached input, cache read, cache write, output, reasoning (part of output). Anthropic `input_tokens` excludes cache tokens; OpenAI `input_tokens` includes them. Screenshot tokens are not reported by either API; estimate them per screenshot (Claude: 28 px patches; OpenAI: 32 px patches times the model multiplier).

**Cost** = sum of bucket x rate from a bundled, dated `prices.json` (rates per bucket, `sourceUrl`, `retrievedAt`), with tier rules (Haiku 5.5 above 100K input tokens per request, OpenAI above 272K) and service-tier modifiers when the response reports them. An optional user override file merges over it. `npm run prices:check` diffs the official pricing pages against the bundled table. Cost is labelled approximate.

## 8. Output

Ticket: [Results and logs](https://github.com/sredhu37/webmcp-101/issues/8).

```
runs/2026-10-15_14-30-05/            one folder per Run, git-ignored
├── results.json
├── baseline/
│   ├── log.jsonl
│   └── screenshots/001-find-red-shirt-attempt-1.jpg ...
└── webmcp/
    ├── log.jsonl
    └── screenshots/001-find-red-shirt-attempt-1.jpg ...
```

Screenshot files: `NNN-<scenario-id>-attempt-<n>.jpg`, NNN counting up per Lane folder in the order taken. Only agent `screenshot()` calls are saved and counted, never live-view frames.

### results.json, top to bottom

1. `run`: startedAt, durationMs, siteUrl, provider, model, attempts, limits, priceTable version, systemPrompt version, stoppedByUser.
2. `summary`: per Lane: pass, fail, durationMs, steps, tokens, costUsd, toolCalls, screenshots.
3. `scenarios[]`: each with `comparison` (per Lane, averaged over Attempts, with min/max and pass rate when Attempts > 1), then `attempts[]`.
4. `suite`: copy of the Suite that ran.

Per Attempt per Lane: outcome, reason, answer, durationMs, steps, tokens (input, cacheRead, cacheWrite, output, reasoning, screenshotEstimate), costUsd, toolCalls by name, toolCallsTotal, screenshots, webmcpTools used.

Comparisons store raw Baseline and WebMCP values side by side: no percentages, no difference fields. Costs at full precision, rounded only for display.

### log.jsonl, one per Lane

One event per line, in time order. Every line has `t` (ISO timestamp, ms), `lane`, `scenario`, `attempt`, `event`. Events: `lane_start`, `model_call`, `tool_call`, `webmcp_tools_changed`, `reminder`, `finish`, `check`, `lane_end`, `error`. Model text and tool inputs in full; tool results cut at 2,000 characters; screenshots referenced by file name.

## 9. UI

Ticket: [UI layout](https://github.com/sredhu37/webmcp-101/issues/12). Reference prototype: branch [`prototype/ui-layout`](https://github.com/sredhu37/webMCP-comparer/blob/prototype/ui-layout/prototypes/ui-layout/index.html).

One scrolling page:

- **Sidebar** (collapsible): Past Runs with date, Site URL, model, pass counts per Lane, Open, Zip. Opening a past Run loads its settings into Setup (key never stored), its results into Results, and each Lane's last screenshot into Live.
- **Setup**: Site URL (prefilled `http://localhost:4000`), Suite (upload or edit; prefilled with `../app/suite.yaml`), Scenario checkboxes with Select all / Select none (first ticked), provider, model, API key, Repeat, limits. Locked during a Run. Button names its action, e.g. "Run 2 Scenarios".
- **Live** (scrolls into view on Run): two columns split by a 1px rule; per Lane: name, status (Running, or Pass/Fail with reason and time), live screen, Step meter against the Step limit. Below the screens, a scoreboard of Time, Steps, Tokens, Cost, Tool calls, Screenshots. Below that, each Lane's tool-call log, newest first, WebMCP tools highlighted. Stop Run.
- **Results** (scrolls into view when done): one legend for Lane colours; Run summary with pass counts and paired bars per metric; Scenarios collapsed by default, each header showing Pass/Fail per Lane and any Fail reason; expanding shows that Scenario's bars and tool calls per Attempt.

Visual rules:

- Lower value green, higher red, equal neutral (display only).
- Restrained: no gradients, glows, glass, purple, emoji or unicode icons, section numbers or decorative motion. Flat 1px rules, 6px radius.
- Palette: warm paper ground, dark ink sidebar, Baseline sand `#a3824f`, WebMCP ink blue `#2350a8`.
- Type: IBM Plex Sans; IBM Plex Mono only for YAML, Scenario ids, logs and numbers. Fonts self-hosted.
- One authored line-icon set.
- Motion only where it informs: screenshot cross-fade, new log entries, value tick, result bars grow once. Respects reduced motion.

## 10. Site under test

Ticket: [Demo site](https://github.com/sredhu37/webmcp-101/issues/13).

- The comparer ships no demo shop. The site to compare lives in `../app` of the webmcp-101 monorepo and runs on http://localhost:4000. Its Suite, `../app/suite.yaml`, is the default Suite in Setup; when the file is missing, Setup shows a one-Scenario placeholder.
- `test/fixture/` is a test-only to-do page with two imperative WebMCP tools (`add_todo`, `list_todos`), a declarative `create_todo` form on `/new`, `window.todos.list()` for `script` checks, and `test/fixture/suite.yaml`. Only the tests use it.

## 11. Implementation defaults

Chosen while writing this spec from the research findings; not discussed one by one. Change any of them before building.

| Topic | Default | Source |
| --- | --- | --- |
| WebMCP tool list | Re-read `page.webmcp.tools()` before every Step; log changes as `webmcp_tools_changed` | WebMCP research: tools change on navigation and late registration |
| WebMCP call timeout | 15 s per `callTool`; timeout returns a tool error to the agent | `callTool` has no default timeout; non-auto-submit forms hang |
| WebMCP input check | Validate input against the tool's `inputSchema` before calling; invalid input returns a tool error (counted as a tool call) | Chromium does not validate inputs |
| WebMCP results | MCP `content` passed through; plain strings and objects wrapped as text; `isError` and thrown errors returned as tool errors | Results come back in mixed shapes |
| Name clash | A WebMCP tool named like a Browser tool is exposed as `site_<name>` | Avoid ambiguous tool names |
| Zero WebMCP tools | Pre-Run check opens each selected Scenario's start page with WebMCP on; if it has no tools, the UI warns but still allows the Run | WebMCP research |
| Cost limit | Checked after every Step; a Lane may overshoot by at most one Step | Cost is only known after a call |
| Live view | Last frame cached per Lane and replayed to new viewers; frame rate capped at 10 fps | Live view research |
| Price override file | `~/.webmcp-comparer/prices.json` | Pricing research |
| First live call | First build ticket makes one real call per model to confirm effort support and usage fields | Agent loop and model tickets |

## 12. Out of scope for v1

- Cloud deployment, hosting, multi-user access, authentication.
- Docker packaging.
- A headless CLI (Run logic stays separate from the UI so one can be added later).
- Browsers other than Chromium.
- WebMCP tools inside iframes.
- An LLM judge for Success checks.
- A poster-style Run recap or video export.
