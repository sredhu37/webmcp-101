---
name: demo
description: Use after building or changing a UI feature, to record a video of it running locally so the user can review it fast.
---

# Demo

Record a short video of the change you just made. The same Playwright specs run in CI (`.github/workflows/comparer-demo.yml` at the webmcp-101 root).

## Steps

1. Add or update `e2e/<feature>.spec.ts`. Copy the pacing style of `e2e/setup-page.spec.ts`: real assertions, and `await page.waitForTimeout(800)` between steps so a human can follow. Never call a real model (it costs money); stay on UI behavior or use the shop in `../app` on :4000.
2. Run `npm run e2e` (starts the app on :3000 if it is not running).
3. The video is `e2e/test-results/<test-name>/video.webm`. Copy it to `e2e/demo-output/<feature>.webm` and run `open` on it.
4. Report the path and one sentence per step shown. If the test failed, say so; do not hide it.
