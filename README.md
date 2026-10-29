# WebMCP 101

Make a website usable by AI browser agents with [WebMCP](https://developer.chrome.com/docs/ai/webmcp), then measure the difference.

[![Buy me a coffee](https://img.shields.io/badge/Buy%20me%20a%20coffee-Ko--fi-FF5E5B?logo=kofi&logoColor=white)](https://ko-fi.com/sunnyredhu)

| Folder | What it is |
| --- | --- |
| [`app/`](app/) | A small React demo shop with no WebMCP tools. Add them yourself. |
| [`webmcp-comparer/`](webmcp-comparer/) | Runs the same task on a site twice, with and without WebMCP, and compares time, steps, tokens and cost. |

## Getting started

Needs Node 24 or newer and Chrome with WebMCP turned on in `chrome://flags`.

```bash
git clone https://github.com/sredhu37/webmcp-101.git
cd webmcp-101/app && npm install && npm start     # shop on http://localhost:4000
```

In a second terminal:

```bash
cd webmcp-101/webmcp-comparer && npm install && npm run dev   # comparer on http://localhost:3000
```

In the comparer, set the Site URL to http://localhost:4000 and load [`app/suite.yaml`](app/suite.yaml).

## Step by step

`main` has the shop without tools. Each `webmcp` branch adds one step on top of the previous one:

```bash
git switch webmcp1
```

## Working with AI agents

- Rules and definition of done: [AGENTS.md](AGENTS.md)
- Architecture map: [ARCHITECTURE.md](ARCHITECTURE.md), vocabulary: [GLOSSARY.md](GLOSSARY.md), decisions: [docs/adr](docs/adr)
- Matt Pocock skills (`/grill-with-docs`, `/wayfinder`, `/triage`, `/handoff`, `/tdd`) are enabled in `.claude/settings.json`. Install once per clone:

```bash
claude plugin install mattpocock-skills@claude-plugins-official --scope project
```

## Support

If this saved you time, you can [buy me a coffee](https://ko-fi.com/sunnyredhu).
