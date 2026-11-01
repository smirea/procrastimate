# Decisions

ProcrastiMate's concepts, goals, paradigms, and high-level system decisions, one file per area. Read the areas your work touches before starting. When a change introduces or revises one of these, record it in the matching area file in the same PR as the work, or add a new file and list it here when no area fits. Replace stale entries instead of keeping history; git keeps the history.

- [Product goals](product.md): what ProcrastiMate is, who it is for, and the snappy local-first bar.
- [Workflow](workflow.md): how threads, PRs, rebases, tests, and screenshots work, and building every feature for all clients.
- [UX principles](ux-principles.md): mobile-first layout, touch, motion, and Liquid Glass parity.
- [Visual language](visual-language.md): the Liquid Glass materials, shapes, motion, accessibility fallbacks, and rendering pick.
- [Theming](theming.md): System, Light, and Dark themes, semantic tokens, and contrast.
- [Domain](domain.md): tasks, views, projects, labels, priorities, and reminders.
- [Lists](lists.md): the one catalog of top-level lists every menu reads, why empty lists stay, and the Tomorrow and This week views.
- [Quick add and natural language](quick-add.md): the quick add parser, its phrases, guards, and autocomplete.
- [Ramble](ramble.md): voice capture with ElevenLabs Scribe, the spoken grammar, precision rules, and the proxy. Its research, test plan, cost, and build slices are in [Ramble design](../ramble-design.md).
- [List header and filters](list-header.md): one header for every list, the `…` menu's order, the filter menu by creator and priority, and its persistence.
- [Labels UI](labels.md): how labels show and are edited in rows, the sidebar, and pickers.
- [Settings](settings.md): the sidebar Settings row, its popover or sheet, and what it holds.
- [Todoist import](todoist-import.md): importing a Todoist backup zip, field mapping, nesting, and re-runs.
- [Places and events](places-and-events.md): tasks on a place or a calendar event, their triggers, overdue rules, calendar sync, and the sidebar sections.
- [Recurring tasks](recurrence.md): completing, next occurrences, and editing repeats.
- [Search](search.md): matching, ranking, grouping, and the search sheet.
- [Sections](sections.md): Todoist-style headings inside a project, their order, delete rule, quick add `/name`, sharing, and import.
- [Task images](images.md): images on tasks, their bytes in the server's database outside the synced data, the image routes, upload order, offline, and the sweep.
- [Subtasks](subtasks.md): nested child tasks, where they show, completion, reorder, and delete rules.
- [Push notifications](push-notifications.md): Web Push scheduling, delivery, keys, and permission.
- [Stack](stack.md): tooling, client and server frameworks, and shared code.
- [API and database types](api.md): the Drizzle schema, the oRPC contract, and the types generated for every client.
- [Dev hosting](dev-hosting.md): the SQLite file every worktree's Bun server runs on, the Durable Object limits local runs enforce, the dev box, `tailscale serve`, and the single-origin rule.
- [Production hosting](production-hosting.md): the Cloudflare Worker, the `App` and `Ramble` Durable Objects, the crons, secrets, deploys, and free-tier fit.
- [Persistence](persistence.md): the clients' sync-engine databases, source keys, the server's SQLite, its additive migration, backups, and restore.
- [Sync](sync.md): sync-engine, one space for every user with the server's rules as its hooks, per-reader pulls, last-write conflicts, and how readers resolve dangling references.
- [Testing](testing.md): unit tests, end-to-end tests, and the feature map.
- [iOS app](ios.md): the native SwiftUI app, its architecture, the Swift port and shared test vectors, local notifications, macOS CI, and paired parity tests. Its checklist and thread split are in [iOS parity](../ios-parity.md).
- [Auth](auth.md): Better Auth sessions, Google and Apple, and per-user data.
- [Sharing](sharing.md): spaces, actors, shares, public links, AI accounts and their tokens, and who did what.
- [Link previews](link-previews.md): a pasted URL becoming `[title](url)`, the server's title and favicon routes, and the site icon before every link.
- [Comments](comments.md): comments on tasks, who may write them, per-user read markers, row badges, and the agent routes.
- [Integrations](integrations.md): other apps, starting with Notouroboros, creating and reading tasks through the server, the shared keychain link, and deep links, and the Tinycast launcher extension.
- [Observability](observability.md): Sentry projects for every client, when they report, the browser tunnel, distributed tracing, and releases.
- [Sync tokens and access](sync-auth.md): the session token sync carries, the `access` table, admission on sync, and the install id.
- [sync-engine migration](../sync-engine-migration.md): why Postgres and PowerSync gave way to sync-engine, the target design, and how production's data moved.
