# Push notifications

Stefan gets a system notification at each task's due time and at each reminder, even when Procrastimate is closed, for tasks changed on any synced device. The server computes the times from the synced tasks, so a device needs sync on first. He turns push on once per device from the sidebar's `Notifications` row, which explains what will notify before the browser asks for permission. On iPhone the app must first be added to the Home Screen, and the same panel walks him through that. Tapping a notification opens its task. A date with no time never notifies, and a moment notifies once even when a reminder lands on the due time.

## Sub-features

- `push-sheet` opens the Notifications panel from the sidebar or drawer row, which shows `On`, `Off`, `Blocked`, or `Set up`. The panel has one view per state: `Turn on sync first`, `Get notified when tasks are due`, `Add Procrastimate to your Home Screen`, `Notifications are blocked`, `Notifications are on`, `Notifications aren’t available on this server`, and `Notifications aren’t supported here`.
- `push-needs-sync` shows `Turn on sync first` on a device that is not paired, and its `Turn on sync` opens Settings. Removing the device from sync brings this view back.
- `push-permission` asks for permission only from `Turn on notifications`. A denial shows how to re-allow it, with `Check again`.
- `push-install` explains Add to Home Screen in a Safari tab on iPhone. A web app manifest and icons make the app installable, and Chromium browsers also get `Install app`.
- `push-schedule` keeps each subscribed device's schedule on the server equal to the future due times and reminders of the account's incomplete tasks, in the synced time zone. Adding, editing, completing, deleting, or restoring a task on any device updates it after that device syncs. Completing a repeating task schedules its next occurrence.
- `push-deliver` sends each scheduled moment once at its time to every subscribed device, as a notification titled with the task and a short body such as `Due now` or `Due at 6:00 PM`.
- `push-test` sends a test notification from `Send a test notification`, and `Turn off` stops push on this device.
- `push-nudge` offers `Get notified when it’s due?` with `Turn on` once per session, when saving a task first gives it a time to notify while push is off.
- `push-open` opens a task's details when its notification is tapped.
- `push-rekey` moves a subscription made for an old server key to the current one on launch, with no prompt, so a VAPID rotation leaves push `On`.

## How to get to it (user POV)

- Web: open the sidebar (on a phone, `Open navigation`) and choose `Notifications`.
- Web: save a timed task while push is off, then choose `Turn on` in the toast.
- iPhone: in Safari, Share, then Add to Home Screen. Open the Home Screen app and choose `Notifications`.
- iOS native: `Notifications` in the Browse tab; the app schedules local notifications, with no server.

## Driving it with control-ui and Playwright

Preconditions:

- Push needs the Worker. Run `bun run preview` (it writes `.dev.vars` from env-manager `local`, or generates a VAPID pair once without AWS; add `SYNC_SETUP_CODE=<code>` there by hand when env-manager has none), or use production. The Bun dev server from `bun run start` has no VAPID keys or alarms, so the panel says push is not available, though its account still registers subscriptions and computes the schedule.
- The device must have sync on (Settings, `Set up sync` or `Enter a pairing code`) before `Turn on notifications` shows.
- Real delivery needs a browser that can subscribe. Playwright's Chromium cannot (no push service keys, and incognito contexts are refused). Google Chrome with a persistent profile can.

- **Real push end to end.** `SYNC_SETUP_CODE=<code> bun app-web/scripts/verify-push.ts [BASE_URL]` (default `http://localhost:8787`) drives headless Google Chrome. It turns sync on, turns notifications on through the panel, gets a real FCM subscription, then receives a test push. A sandbox that blocks Chrome's connection to FCM gets a `2xx` from the server but never the push. It adds tasks due at the next minute, deletes, completes, and edits some, and closes the app. It then checks that only the live tasks notified, and that completing a repeating task scheduled its next occurrence. It prints `PASS` or `FAIL` for each step.
- **Panel views and the server schedule.** `bun run test:e2e -- e2e/push.e2e.ts` covers the row and the panel, `Turn on sync first` before pairing and after removing the device, turning on and off, the schedule the dev server computes from synced tasks (complete and undo), the denied view, the one-time nudge, and opening a task from `/today?task=<id>` and from the service worker. It stubs the subscription because Playwright's Chromium cannot subscribe, and gives each test its own endpoint because the server keeps one device per endpoint.
- **iPhone install guidance.** `in a Safari tab the Notifications sheet explains Add to Home Screen first` in `e2e/mobile.e2e.ts` shows the three steps in WebKit at iPhone size.
- **Worker schedule, alarm, and delivery.** `bun run build && E2E_WORKER=1 bun run test:e2e -- e2e/push-worker.e2e.ts` runs against `wrangler dev`. A loopback push service decrypts what the Worker sends and checks its VAPID signature. The suite proves the test push, one entry per moment, no date-only entries, cancellation on complete, edit, and delete, the next occurrence of a repeating task, and that a task synced from another device is pushed once at its time by the account's alarm, even after a resync. The alarm test waits for the next whole minute.
- **Server rules.** `bun test server/src/account/push.test.ts server/src/push-schedule.test.ts shared/zoned-time.test.ts` covers several devices, the synced time zone, completion, repeating tasks, retries, staleness, gone subscriptions, revoke, and daylight saving edges.
- **iOS.** Browse shows `Notifications` with `Off`, `On`, or `Blocked`. The screen asks for permission only from `Turn on notifications`, a denial shows `Notifications are blocked` with `Open Settings`, and once on it reads `3 scheduled on this device` for `Call mom today 10:30am r20m`, `Taxes today`, `Gym tomorrow 6pm`, and a completed timed task. Each request is titled with its task, with a body such as `Due now`, under the identifier `<taskId>:<epoch ms>`. `Send a test notification` turns to `Sent`, `Turn off` clears the schedule, the first timed task saved while off shows `Get notified when it’s due?` once per launch, and tapping a delivered notification opens its task. DEBUG builds carry the pending requests as `title@<ISO time>: body` in the accessibility identifier of the scheduled count. Tests: `NotificationsParityTests` (`test_push_sheet`, `test_push_permission`, `test_push_schedule`, `test_push_deliver`, `test_push_test`, `test_push_nudge`, `test_push_open`), paired with `e2e/parity/notifications.e2e.ts`, which pairs the page with sync and stands in for the push service. Run each pair with the iOS workflow (`xcodebuild test` on an iPhone 16 simulator) and `bun run test:e2e --project=parity`; both sides save `<parity-id>.png`.
- **Physical iPhone.** Planned: no automated path. Add to Home Screen on iOS 16.4 or later, turn notifications on, and send a test notification.

## Gotchas

- The schedule lives in the `Account` object per device and comes from the synced tasks, so a change shows up there only after its device syncs, about a second after the edit.
- Headless Chromium reports notification permission as denied even after `grantPermissions`, so the e2e suite stubs `Notification.permission`, `requestPermission`, and `PushManager`.
- `GET /api/push/schedule` with the device's `Authorization: Bearer <token>` (from `localStorage` key `procrastimate-device`) shows what the server will push to that device. Use it to inspect a run, not as a user path.
- Every test that syncs shares the server's one account, so specs filter the schedule by a unique title suffix.
- A notification more than ten minutes late is dropped instead of delivered.
- Turning the server's VAPID keys over resubscribes each device with the new key on its next launch, without a prompt, and it stays `On`. A device whose permission was reset goes `Off` instead.
