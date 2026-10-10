# Testing

- **Unit tests.** `bun test`, colocated as `*.test.ts`. The natural-language parser is tested with a fixed clock. Theme contrast is tested against the real tokens in `index.css`.
- **End to end.** Playwright drives the real web UI against an isolated dev server, from `app-web/e2e/*.e2e.ts`. The `desktop` project runs in Chromium at 1280×800. The `mobile` project runs `e2e/mobile.e2e.ts` in WebKit with the iPhone 15 Pro profile and covers the main flows by touch.
- **Feature map.** `.cursor/skills/verify-procrastimate/features/` describes each user-facing feature and how to drive it. Keep it in sync with every change.
