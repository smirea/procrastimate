# Push notifications

Stefan gets a system notification at each task's due time and at each reminder, even when Procrastimate is closed. He turns it on once per device from the sidebar's `Notifications` row, which explains what will notify before the browser asks for permission. On iPhone the app must first be added to the Home Screen, and the same panel walks him through that. Tapping a notification opens its task. A date with no time never notifies, and a moment notifies once even when a reminder lands on the due time.

## Sub-features

- `push-sheet` opens the Notifications panel from the sidebar or drawer row, which shows `On`, `Off`, `Blocked`, or `Set up`. The panel has one view per state: `Get notified when tasks are due`, `Add Procrastimate to your Home Screen`, `Notifications are blocked`, `Notifications are on`, `Notifications aren’t available on this server`, and `Notifications aren’t supported here`.
- `push-permission` asks for permission only from `Turn on notifications`. A denial shows how to re-allow it, with `Check again`.
- `push-install` explains Add to Home Screen in a Safari tab on iPhone. A web app manifest and icons make the app installable, and Chromium browsers also get `Install app`.
- `push-schedule` keeps the server's schedule for this device equal to the future due times and reminders of incomplete tasks. Adding, editing, completing, deleting, or restoring a task updates it. Completing a repeating task schedules its next occurrence.
- `push-deliver` sends each scheduled moment once at its time, as a notification titled with the task and a short body such as `Due now` or `Due at 6:00 PM`.
- `push-test` sends a test notification from `Send a test notification`, and `Turn off` stops push on this device.
- `push-nudge` offers `Get notified when it’s due?` with `Turn on` once per session, when saving a task first gives it a time to notify while push is off.
- `push-open` opens a task's details when its notification is tapped.

## How to get to it (user POV)

- Web: open the sidebar (on a phone, `Open navigation`) and choose `Notifications`.
- Web: save a timed task while push is off, then choose `Turn on` in the toast.
- iPhone: in Safari, Share, then Add to Home Screen. Open the Home Screen app and choose `Notifications`.
- iOS native: Planned: not built yet.

## Driving it with control-ui and Playwright

Preconditions:

- Push needs the Worker. Run `bun run preview` (it writes VAPID keys to `.dev.vars` once), or use production. The Bun dev server from `bun run start` has no push, so the panel says it is not available.
- Real delivery needs a browser that can subscribe. Playwright's Chromium cannot (no push service keys, and incognito contexts are refused). Google Chrome with a persistent profile can.

- **Real push end to end.** `bun app-web/scripts/verify-push.ts [BASE_URL]` (default `http://localhost:8787`) drives headless Google Chrome. It turns notifications on through the panel and gets a real FCM subscription, then receives a test push. It adds tasks due at the next minute, deletes, completes, and edits some, and closes the app. It then checks that only the live tasks notified, and that completing a repeating task scheduled its next occurrence. It prints `PASS` or `FAIL` for each step.
- **Panel views.** `bun run test:e2e -- e2e/push.e2e.ts` covers the row and the panel, turning on and off, the denied view, the one-time nudge, and opening a task from `/today?task=<id>` and from the service worker. It stubs the subscription because Playwright's Chromium cannot subscribe.
- **iPhone install guidance.** `in a Safari tab the Notifications sheet explains Add to Home Screen first` in `e2e/mobile.e2e.ts` shows the three steps in WebKit at iPhone size.
- **Worker schedule, dedup, and delivery.** `bun run build && E2E_WORKER=1 bun run test:e2e -- e2e/push-worker.e2e.ts` runs against `wrangler dev`. A loopback push service decrypts what the Worker sends and checks its VAPID signature. The suite proves the test push, one entry per moment, no date-only entries, cancellation on complete, edit, and delete, the next occurrence of a repeating task, and a scheduled push delivered once at its time even after the device resyncs it.
- **Physical iPhone.** Planned: no automated path. Add to Home Screen on iOS 16.4 or later, turn notifications on, and send a test notification.

## Gotchas

- The schedule lives on the server per subscription and comes from this device's `localStorage`, so each device notifies for its own tasks until sync exists.
- Headless Chromium reports notification permission as denied even after `grantPermissions`, so the e2e suite stubs `Notification.permission`, `requestPermission`, and `PushManager`.
- `GET /api/push/schedule?endpoint=<url>` shows what the server holds for a subscription. Use it to inspect a run, not as a user path.
- A notification more than ten minutes late is dropped instead of delivered.
- Turning the server's VAPID keys over makes every device show `Off` until it turns notifications on again.
