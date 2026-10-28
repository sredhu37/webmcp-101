# Agent rules

## Workflow
- Work in a git worktree on its own branch, never in the main checkout.
- Align first: for anything beyond a one-line change, run `/grill-with-docs` (or `/grill-me` for non-code). For work too big for one session, run `/wayfinder`.
- Make small changes. Run the tests or the app after each one.
- Do not claim done without showing real command output.

## Definition of done
A change is done only when all of these hold:
1. Tests and linters pass, with real output shown.
2. For a UI change: a demo video exists (`/demo` locally, CI uploads it on the pull request).
3. `ARCHITECTURE.md` is updated if structure changed. New terms go in `GLOSSARY.md`, hard decisions in `docs/adr/`.
4. A handoff is written: what changed, what is verified, what is left (`/handoff`).

## Style
- No em dashes. Direct tone. No filler in code comments or docs.
- Prefer boring, readable code over clever code.
- Do not add dependencies without saying why.

## Safety
- Never commit secrets, tokens, or .env files.
- Ask before destructive actions: force push, history rewrite, deleting data.
- Verify facts against primary sources. Label what is unverified.

## Agent skills

### Issue tracker

GitHub Issues via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Default five labels (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `GLOSSARY.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.

### Which skill when
- `/grill-with-docs`: before building, to align and build the glossary.
- `/wayfinder`: plan work too big for one session.
- `/triage`: sort incoming issues.
- `/demo`: record a video of the feature just built.
- `/handoff`: finish a task.
