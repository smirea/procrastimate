# Decisions

This is the single source for Procrastimate's concepts, goals, paradigms, and high-level system decisions. Read it before starting any work. When a change introduces or revises one of these, update this file in the same PR as the work. Replace stale entries instead of keeping history; git keeps the history.

## Product goals

- **Personal Todoist.** Procrastimate is Stefan's personal task manager, modeled on Todoist. Todoist is the reference for behavior and interaction unless this file says otherwise.
- **One user.** There is exactly one user. No accounts, sharing, roles, or multi-tenant concerns.
- **Platforms.** Web now, iOS later, Apple Watch after iOS.
- **Features are in flux.** Never keep backwards compatibility. Change data shapes, routes, and storage freely, and delete old behavior instead of migrating it.
- **Local first, synced.** Every change applies to local state at once. Remote sync happens in the background and never blocks an interaction.
- **Extremely snappy.** No spinners or visible delays on local data. Every interaction responds on the first frame.
- **Subtle, satisfying animations.** Motion confirms every interaction without slowing it down.

## UX principles

- **Simple, clean, sharp.** Few controls, generous whitespace, crisp type, and clear hierarchy. Every control earns its place.
- **Mobile first.** The web UI must always work great on an iPhone-sized screen, since Stefan uses it from his phone. Design for a 393 px wide viewport first and widen from there.
  - **Layout.** Below 768 px the sidebar becomes a drawer behind a menu button, a floating add button opens quick add, and quick add and task details open as bottom sheets. From 768 px up the sidebar is always visible and sheets float as a centered dialog and a side panel.
  - **Touch.** Every tap target is at least 44 px on phones and touch screens, using an invisible hit area where the visible control is smaller. Fields use at least 16 px text so iOS does not zoom on focus.
  - **No hover-only interactions.** Hover only adds polish. Every action is reachable by tap, and hover styles apply only on devices that can hover.
  - **Safe areas.** The layout respects `env(safe-area-inset-*)` for the notch, the Dynamic Island, and the home indicator.
  - **On-screen keyboard.** Quick add stays usable while the keyboard is open. Sheets dock above the keyboard by tracking the visual viewport, and the return key submits.
  - **Same shapes as iOS.** The drawer, floating add button, and inset bottom sheets map directly to the Liquid Glass port.
- **Motion on every interaction.** Opening, closing, adding, completing, and switching views all animate. Motion is short (about 150 to 250 ms), eased like a spring, and never gates input.
- **Liquid Glass parity.** The web UI is designed to port to iOS with Liquid Glass. Keep these consistent with native iOS:
  - **Layering.** Content sits on a base layer. Navigation and transient surfaces (sidebar, quick add, task details, toasts) float above it as distinct layers.
  - **Translucency.** Floating layers use translucent, blurred materials over the content beneath, not opaque fills.
  - **Motion.** Sheets and popovers grow from their source and settle with spring easing. Lists reflow with animated position changes.
  - **Spacing.** Use a 4 pt grid, rounded continuous corners, and touch-sized hit targets (at least 32 px with a mouse, 44 px on touch, 44 pt on iOS).
  - **Controls.** Use controls with direct native counterparts: list rows with leading checkboxes, a sidebar that maps to a tab bar or split view, sheets for creation and details, menus for pickers, and toasts for undo. Avoid web-only patterns such as hover-only actions and multi-level dropdowns.

## Domain

- **Task.** A title, optional notes, an optional project, an optional due date with an optional time, a priority, a list of reminders, and an optional completion time.
- **Inbox.** Tasks without a project. Inbox is a view, not a project.
- **Today.** Incomplete tasks due today or earlier. Overdue tasks are marked.
- **Upcoming.** Incomplete tasks due after today, grouped by day.
- **Project.** A named group of tasks. Deleting a project deletes its tasks.
- **Priority.** Todoist's four levels. `p1` is the most urgent and `p4` is the default with no marking.
- **Reminder.** Either relative to the due time (for example 30 minutes before) or at an absolute date and time. A relative reminder needs a due time to fire. Reminders fire as an in-app toast and, when the browser allows it, a system notification, while the app is open.

## Quick add and natural language

- **Todoist quick add is the reference.** One input captures the title and its attributes. Recognized phrases are highlighted inline as you type and removed from the saved title. Clicking a highlighted phrase keeps it as plain text.
- **The same parser runs in quick add and in the task details title field.**
- **Repeated phrases.** Date, priority, and project take the last matching phrase, because attributes usually trail the title. `Today task today` saves `Today task` due today. Reminders keep every match.
- **Pickers win over text.** Choosing a date, priority, or project with a picker removes the matching phrase from the input. Pickers close on selection.
- **Dates.** `today`, `tonight`, `tomorrow`, weekdays (`fri`, `next monday`), `next week`, `in 3 days`, and month dates (`oct 12`, `12 october`). Times are `5pm`, `5:30pm`, `17:00`, `noon`, optionally after `at`. A time with no date means today.
- **Priority.** `p1` to `p4`. `!!!` and `urgent` mean `p1`. `!!` and `important` mean `p2`. A single `!` is never parsed, because it is common in titles.
- **Reminders.** `remind me 30m before`, `remind me 1 hour before`, `remind me at 4pm`, and `remind me tomorrow 9am`. Todoist uses a leading `!` for reminders. Procrastimate does not, because `!!` is a priority shortcut.
- **Projects.** `#Name` assigns an existing project, matched case-insensitively. It is highlighted only when the project exists.
- **Not yet compared against live Todoist.** Todoist's login captcha blocked automated access, so the repeated-phrase rule and the `!!` mapping are our own calls.

## Stack

- **Tooling.** Bun and TypeScript. Oxlint, oxfmt, and Lefthook for linting and hooks.
- **Web client.** Svelte 5 (runes) with SvelteKit 3 as a client-only single-page app (`ssr = false`, static adapter with a `200.html` fallback), Vite, and Tailwind CSS. Chosen for a small runtime, fine-grained reactivity, and built-in transitions and FLIP animations that suit the snappy, animated UX. React and TanStack Router are gone.
- **TypeScript versions.** The root uses TypeScript 7 (`tsc`) for `server/` and `shared/`. `app-web/` pins TypeScript 6 because SvelteKit and `svelte-check` need the TypeScript JS API, which TypeScript 7 does not ship. Bun's isolated linker keeps the two apart.
- **Web env reader.** SvelteKit 3 reserves `src/env.ts`, so env-manager generates the web client's Node-only reader at `app-web/env.ts`. Scripts pass `--env-file=.env.local` because Bun does not auto-load env files when it runs Vite through its `node` shim.
- **Server.** Bun.serve API. It holds no task data yet.
- **Shared domain code.** Environment-independent types and logic, including the natural-language parser, live in `shared/` so the server can reuse them.

## Dev hosting

- **Stefan's dev web client runs on potatoey's box.** Stefan opens it over HTTPS at `https://stf-box.tailff2195.ts.net:6120`. Procrastimate owns ports 6120 (web) and 6121 (API) there.
- **HTTPS through `tailscale serve`.** `tailscale serve` terminates TLS on port 6120 and proxies to the Vite dev server on box-local port 16120 (the public port plus 10000). The API stays on 6121 and the browser reaches it only through `/api`. Plain HTTP on the tailnet is gone, so the app always runs in a secure context there.
- **One origin for the browser.** The web client's server always proxies the backend, so the browser talks to exactly one origin. Browser code calls relative `/api` paths. `API_URL` and any other API host or port stay in Vite's Node-side proxy config and never reach the client through `import.meta.env`, a `PUBLIC_` variable, or the bundle. This holds everywhere, including local dev, the e2e suite, and the box.
- **No third-party origins.** The browser fetches nothing cross-origin. Fonts and other assets ship from the app's own origin, so Google Sans Flex (SIL OFL 1.1) is self-hosted from `@fontsource-variable/google-sans-flex`. The `single-origin` e2e test fails on any request that leaves the page's origin.
- **The box tracks `master`.** Its checkout auto-pulls about every 3 minutes, so every merge is live within minutes.
- **The box starts the client with `--host $HOST --port $PORT` and `__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS=.ts.net`.** Keep the web client compatible with that launch. Vite CLI flags must keep overriding the config's host and port, so never hardcode a bind address or port that flags cannot change. `server.allowedHosts` must stay an array, because Vite only appends the extra hosts to an array. The `/api` proxy must keep working through any allowed host.
- **Use the full tailnet name.** `.ts.net` admits `stf-box.<tailnet>.ts.net`. Vite blocks the bare `stf-box` short name unless the box adds it to the extra allowed hosts.
- **Don't depend on a secure context.** Local runs and tests still use plain HTTP, so browser APIs limited to secure contexts, such as `crypto.randomUUID`, need a fallback.

## Persistence and sync

- **Web persistence.** The whole store is one JSON document in `localStorage`, validated on load and written synchronously on every change. Invalid stored data is discarded, since there is no backwards compatibility.
- **Sync.** Not built yet. The store's mutations are discrete commands so they can become a sync log later.

## Testing

- **Unit tests.** `bun test`, colocated as `*.test.ts`. The natural-language parser is tested with a fixed clock.
- **End to end.** Playwright drives the real web UI against an isolated dev server, from `app-web/e2e/*.e2e.ts`. The `desktop` project runs in Chromium at 1280×800. The `mobile` project runs `e2e/mobile.e2e.ts` in WebKit with the iPhone 15 Pro profile and covers the main flows by touch.
- **Feature map.** `.cursor/skills/verify-procrastimate/features/` describes each user-facing feature and how to drive it. Keep it in sync with every change.
