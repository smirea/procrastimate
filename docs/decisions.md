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
- **Motion on every interaction.** Opening, closing, adding, completing, and switching views all animate. Motion is short (about 150 to 250 ms), eased like a spring, and never gates input.
- **Liquid Glass parity.** The web UI is designed to port to iOS with Liquid Glass. Keep these consistent with native iOS:
  - **Layering.** Content sits on a base layer. Navigation and transient surfaces (sidebar, quick add, task details, toasts) float above it as distinct layers.
  - **Translucency.** Floating layers use translucent, blurred materials over the content beneath, not opaque fills.
  - **Motion.** Sheets and popovers grow from their source and settle with spring easing. Lists reflow with animated position changes.
  - **Spacing.** Use a 4 pt grid, rounded continuous corners, and touch-sized hit targets (at least 32 px on web, 44 pt on iOS).
  - **Controls.** Use controls with direct native counterparts: list rows with leading checkboxes, a sidebar that maps to a tab bar or split view, sheets for creation and details, menus for pickers, and toasts for undo. Avoid web-only patterns such as hover-only actions and multi-level dropdowns.
