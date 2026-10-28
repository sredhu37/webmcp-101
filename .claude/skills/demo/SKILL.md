---
name: demo
description: Use after building or changing a feature, to record a video of it running locally so the user can review it fast.
---

# Demo

Produce a short video of the change you just made. The same Playwright spec runs in CI (`.github/workflows/demo.yml`).

## Steps
1. Find how to start the app (`package.json` scripts, README). If it has no UI, use the terminal route below.
2. If `e2e/playwright.config.ts` is missing, copy the files from this skill's `templates/` into `e2e/` and set `baseURL` and `webServer.command`.
3. Write or update `e2e/<feature>.spec.ts`. It must walk through the changed behavior, with `await page.waitForTimeout(800)` between steps so a human can follow, and real assertions so it also works as a test.
4. Run `cd e2e && npx playwright test <feature>`. Video lands in `e2e/test-results/**/video.webm`.
5. Copy the video to `e2e/demo-output/<feature>.webm` and run `open` on it.
6. Report the path and one sentence per step shown. If the test failed, say so; do not hide it.

## No UI
Record the terminal with VHS (`brew install vhs`): write `demo.tape` with the commands, run `vhs demo.tape`, open the result.
