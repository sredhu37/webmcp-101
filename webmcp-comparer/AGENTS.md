# webMCP-comparer

Part of the webmcp-101 monorepo (`sredhu37/webmcp-101`); this folder is `webmcp-comparer/`. Local agentic UI that runs the same Scenario against the same website in two Lanes side by side (Baseline and WebMCP) and compares tokens, time, cost, tool calls and screenshots.

## Git worktrees (parallel sessions)

Several agent sessions often run on this repo at the same time. Never edit in the main checkout. Worktrees live at the monorepo root, not in this folder.

- Start every task in its own worktree from an up-to-date `main`, run from the webmcp-101 root: `git fetch origin && git worktree add -b <type>/<slug> .claude/worktrees/<slug> origin/main` (`<type>`: `feat`, `fix`, `docs`, `chore`).
- Copy what git does not track into it, from the webmcp-101 root: `cp -Rc webmcp-comparer/node_modules webmcp-comparer/.env* .claude/worktrees/<slug>/webmcp-comparer/` (APFS clone; skip what is missing).
- Keep the main checkout clean on `main`. If you find uncommitted work there, move it into a worktree first, then tell Sunny.
- After the PR merges: `git worktree remove .claude/worktrees/<slug>` and delete the branch.

## Definition of done

A change is done only when all of these hold:

1. `npm run lint`, `npm run typecheck` and `npm test` pass, with real output shown.
2. For a UI change: a demo video exists (`/demo` locally; CI uploads it on the pull request).
3. `ARCHITECTURE.md` is updated if structure changed. New terms go in `GLOSSARY.md`, hard decisions in `docs/adr/`.
4. A handoff is written: what changed, what is verified, what is left (`/handoff`).

## Agent skills

### Issue tracker

Issues, the wayfinder map and its decision tickets live in GitHub Issues on `sredhu37/webmcp-101`. See `docs/agents/issue-tracker.md`.

### Domain docs

Single-context: one `GLOSSARY.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.

### Triage labels

Default five labels (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Which skill when

- `/grill-with-docs`: before building, to align and extend the glossary.
- `/wayfinder`: plan work too big for one session.
- `/triage`: sort incoming issues.
- `/demo`: record a video of the UI change just built.
- `/handoff`: finish a task.

The Matt Pocock plugin is enabled in `.claude/settings.json`. Install once per clone: `claude plugin install mattpocock-skills@claude-plugins-official --scope project`.
