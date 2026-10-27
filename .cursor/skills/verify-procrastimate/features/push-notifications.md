# Push notifications

Stefan gets a system notification at each task's due time and at each reminder, even when ProcrastiMate is closed, for tasks changed on any device. The server computes the times from the synced tasks. The app asks for permission on first load (web) and first launch (iOS). If the browser still needs a gesture, the first click or keypress asks, with no prompt copy. Settings has one line: `Notifications: On`, `Notifications: Off`, or `Notifications need permission`. The last one is tappable: the web asks again, and iOS opens system Settings. Tasks that notify at the same moment share one notification, titled with their count, and tapping it opens the list they share. Tapping a lone task's notification opens its task. A date with no time never notifies, and a moment notifies once even when a reminder lands on the due time. There is no in-app reminder toast; the system notification shows whether the app is open or closed, and iOS marks it time-sensitive.

## Sub-features

- `push-sheet` is the settings line: `Notifications: On`, `Notifications: Off`, or `Notifications need permission`. There is no Notifications panel and no sidebar row.
- `push-permission` asks on first launch or first load. A denial is the tappable line `Notifications need permission`.
- `push-schedule` keeps each subscribed device's schedule on the server equal to the future due times and reminders of the account's incomplete tasks, in the synced time zone. Adding, editing, completing, deleting, or restoring a task on any device updates it after that device syncs. Completing a repeating task schedules its next occurrence.
- `push-deliver` sends each scheduled moment once at its time to every subscribed device, as a notification titled with the task and the due day and time as its body, such as `Today 3:00 PM`. iOS notifications are time-sensitive and show their banner in the foreground too.
- `push-group` folds every task that notifies at one moment into one notification: `4 tasks at Austin`, `2 tasks for Night out`, or `3 tasks`, its body the first three titles and `and N more`. Unit tests: `tasks at one moment share a notification that counts them, lists three, and opens their place` and `a group opens the event, else the project, else Inbox that its tasks share` in `shared/notifications.test.ts`, and `tasks due at the same minute send one push that names them and opens their list` in `server/src/push.test.ts`.
- `push-nudge` does not exist. Saving a timed task shows no `Turn on` toast.
- `push-open` opens a task's details when its notification is tapped, and a group's shared list: its event, place, project, or else Inbox. E2E: `e2e/notifications.e2e.ts` taps a two-task group and lands on its project.
- `push-refused` waits a day after the push service refuses to subscribe (Chrome's `push service error`) before trying again on a launch or tab switch. Unit test: `a push service refusal holds for a day, then asks once more` in `app-web/src/lib/push-refusal.test.ts`.
- `push-rekey` moves a subscription made for an old server key to the current one on launch, with no prompt, so a VAPID rotation leaves push `On`.

## How to get to it (user POV)

- Web and iOS: open `Settings`. The line is the whole control.
- iOS native schedules local notifications. The web subscribes for Web Push once permission is granted and the install has registered.

## Driving it with control-ui and Playwright

Preconditions:

- Push needs the Worker. Run `bun run preview` (it writes `.dev.vars` from env-manager `dev`, or generates a VAPID pair once without AWS; ), or use production. The Bun dev server from `bun run start` has no VAPID keys or alarms, so Settings reads `Notifications: Off`, though its account still registers subscriptions and computes the schedule. Sync is already on.
- Real delivery needs a browser that can subscribe. Playwright's Chromium cannot (no push service keys, and incognito contexts are refused). Google Chrome with a persistent profile can.

- **Real push end to end.** `bun app-web/scripts/verify-push.ts [BASE_URL]` (default `http://localhost:8787`) drives headless Google Chrome. The install registers on its own, and the script waits for Settings to read `Notifications: On`. When it never does, the `FAIL` line prints why: the errors the browser's `pushManager.subscribe` threw (such as FCM's `AbortError: Registration failed - push service error`), any failed `/api/push/` response, the permission, the current subscription, and the stored refusal time. It adds tasks due at the next minute, deletes, completes, and edits some, and closes the app. After the due time, at least 45 s after subscribing, it posts `/api/push/test` with the page's subscription, because FCM answers 410 or silently drops pushes to a token for up to about 25 s after Chrome registers it. A sandbox that blocks Chrome's connection to FCM gets a `2xx` from the server but never the push. Against `localhost` (`bun run preview`, whose `.dev.vars` carries a generated VAPID pair when env-manager is out of reach) it fires the delivery cron itself, since `wrangler dev` runs crons only on request. It then checks that the two live tasks due at that minute arrived as one `2 tasks` notification, and that completing a repeating task scheduled its next occurrence. It prints `PASS` or `FAIL` for each step.
- **The settings line and the server schedule.** On the Bun dev server, Settings reads `Notifications: Off` because it cannot push. `GET /api/push/schedule` shows the schedule it computes from synced tasks. A denied permission shows as one tappable line and there is no `Turn on` toast. Opening `/inbox?task=<id>` opens that task, and a notification tap with no open window opens the same address.
- **Worker schedule, alarm, and delivery.** Run `bun run preview`. The schedule holds one entry per moment and none for date-only tasks. Completing, editing, or deleting a task cancels its entry, and completing a repeating task schedules its next occurrence. A task synced from another device is pushed once at its time by the account's alarm, even after a resync. The alarm fires on the next whole minute.
- **Server rules.** `bun test server/src/push.test.ts server/src/push-schedule.test.ts shared/zoned-time.test.ts` covers several devices, the synced time zone, completion, repeating tasks, retries, staleness, gone subscriptions, a fresh subscription's early 410, revoke, and daylight saving edges.
- **iOS.** Settings shows `Notifications: Off`, `Notifications: On`, or `Notifications need permission`. The app asks on first launch. A denial is the tappable line. There is no Notifications row, no `Turn on` toast, and no test button. Tapping a delivered notification opens its task, or a group's list. The schedule itself is `NotificationScheduleTests`, and the Swift grouping matches the web's through `shared/vectors/notifications.json`.
- **Physical iPhone.** Allow the first-launch prompt, then confirm Settings reads `Notifications: On` and a due task notifies.

## Gotchas

- The schedule lives in the `Account` object per device and comes from the synced tasks, so a change shows up there only after its device syncs, about a second after the edit.
- Headless Chromium reports notification permission as denied even after `grantPermissions`, so the e2e suite stubs `Notification.permission`, `requestPermission`, and `PushManager`.
- `GET /api/push/schedule` with the device's `Authorization: Bearer <token>` (from `localStorage` key `procrastimate-device`) shows what the server will push to that device. Use it to inspect a run, not as a user path.
- Every test that syncs shares the server's one account, so specs filter the schedule by a unique title suffix.
- A notification more than ten minutes late is dropped instead of delivered.
- Turning the server's VAPID keys over resubscribes each device with the new key on its next launch, without a prompt, and it stays `On`. A device whose permission was reset goes `Off` instead.
