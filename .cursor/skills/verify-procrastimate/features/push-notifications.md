# Push notifications

Stefan gets a system notification at each task's due time and at each reminder, even when Procrastimate is closed, for tasks changed on any device. The server computes the times from the synced tasks. The app asks for permission on first load (web) and first launch (iOS). If the browser still needs a gesture, the first click or keypress asks, with no prompt copy. Settings has one line: `Notifications: On`, `Notifications: Off`, or `Notifications need permission`. The last one is tappable: the web asks again, and iOS opens system Settings. Tapping a notification opens its task. A date with no time never notifies, and a moment notifies once even when a reminder lands on the due time. A reminder toast while the app is open stays.

## Sub-features

- `push-sheet` is the settings line: `Notifications: On`, `Notifications: Off`, or `Notifications need permission`. There is no Notifications panel and no sidebar row.
- `push-permission` asks on first launch or first load. A denial is the tappable line `Notifications need permission`.
- `push-schedule` keeps each subscribed device's schedule on the server equal to the future due times and reminders of the account's incomplete tasks, in the synced time zone. Adding, editing, completing, deleting, or restoring a task on any device updates it after that device syncs. Completing a repeating task schedules its next occurrence.
- `push-deliver` sends each scheduled moment once at its time to every subscribed device, as a notification titled with the task and a short body such as `Due now` or `Due at 6:00 PM`.
- `push-nudge` does not exist. Saving a timed task shows no `Turn on` toast.
- `push-open` opens a task's details when its notification is tapped.
- `push-rekey` moves a subscription made for an old server key to the current one on launch, with no prompt, so a VAPID rotation leaves push `On`.

## How to get to it (user POV)

- Web and iOS: open `Settings`. The line is the whole control.
- iOS native schedules local notifications. The web subscribes for Web Push once permission is granted and the install has registered.

## Driving it with control-ui and Playwright

Preconditions:

- Push needs the Worker. Run `bun run preview` (it writes `.dev.vars` from env-manager `dev`, or generates a VAPID pair once without AWS; ), or use production. The Bun dev server from `bun run start` has no VAPID keys or alarms, so Settings reads `Notifications: Off`, though its account still registers subscriptions and computes the schedule. Sync is already on.
- Real delivery needs a browser that can subscribe. Playwright's Chromium cannot (no push service keys, and incognito contexts are refused). Google Chrome with a persistent profile can.

- **Real push end to end.** `bun app-web/scripts/verify-push.ts [BASE_URL]` (default `http://localhost:8787`) drives headless Google Chrome. The install registers on its own. Once Settings reads `Notifications: On`, the script posts `/api/push/test` with the page's subscription. A sandbox that blocks Chrome's connection to FCM gets a `2xx` from the server but never the push. It adds tasks due at the next minute, deletes, completes, and edits some, and closes the app. It then checks that only the live tasks notified, and that completing a repeating task scheduled its next occurrence. It prints `PASS` or `FAIL` for each step.
- **The settings line and the server schedule.** `bun run test:e2e -- e2e/push.e2e.ts` covers `Notifications: Off` when the server cannot push, the schedule the dev server computes from synced tasks, a rotated key, a denied permission as one tappable line, no `Turn on` toast, and opening a task from `/today?task=<id>` and from the service worker. It stubs the subscription because Playwright's Chromium cannot subscribe, and gives each test its own endpoint because the server keeps one device per endpoint.
- **Worker schedule, alarm, and delivery.** `bun run build && E2E_WORKER=1 bun run test:e2e -- e2e/push-worker.e2e.ts` runs against `wrangler dev`. A loopback push service decrypts what the Worker sends and checks its VAPID signature. The suite proves one entry per moment, no date-only entries, cancellation on complete, edit, and delete, the next occurrence of a repeating task, and that a task synced from another device is pushed once at its time by the account's alarm, even after a resync. The alarm test waits for the next whole minute.
- **Server rules.** `bun test server/src/account/push.test.ts server/src/push-schedule.test.ts shared/zoned-time.test.ts` covers several devices, the synced time zone, completion, repeating tasks, retries, staleness, gone subscriptions, revoke, and daylight saving edges.
- **iOS.** Settings shows `Notifications: Off`, `Notifications: On`, or `Notifications need permission`. The app asks on first launch. A denial is the tappable line. There is no Notifications row, no `Turn on` toast, and no test button. Tapping a delivered notification opens its task. Tests: `NotificationsParityTests` (`test_push_sheet`, `test_push_permission`, `test_push_nudge`, `test_push_open`), paired with `e2e/parity/notifications.e2e.ts`. Run each pair with the iOS workflow (`xcodebuild test` on an iPhone 16 simulator) and `bun run test:e2e --project=parity`; both sides save `<parity-id>.png`. The schedule itself is `NotificationScheduleTests`.
- **Physical iPhone.** Allow the first-launch prompt, then confirm Settings reads `Notifications: On` and a due task notifies.

## Gotchas

- The schedule lives in the `Account` object per device and comes from the synced tasks, so a change shows up there only after its device syncs, about a second after the edit.
- Headless Chromium reports notification permission as denied even after `grantPermissions`, so the e2e suite stubs `Notification.permission`, `requestPermission`, and `PushManager`.
- `GET /api/push/schedule` with the device's `Authorization: Bearer <token>` (from `localStorage` key `procrastimate-device`) shows what the server will push to that device. Use it to inspect a run, not as a user path.
- Every test that syncs shares the server's one account, so specs filter the schedule by a unique title suffix.
- A notification more than ten minutes late is dropped instead of delivered.
- Turning the server's VAPID keys over resubscribes each device with the new key on its next launch, without a prompt, and it stays `On`. A device whose permission was reset goes `Off` instead.
