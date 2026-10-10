# Decisions

Procrastimate's concepts, goals, paradigms, and high-level system decisions, one file per area. Read the areas your work touches before starting. When a change introduces or revises one of these, record it in the matching area file in the same PR as the work, or add a new file and list it here when no area fits. Replace stale entries instead of keeping history; git keeps the history.

- [Product goals](product.md): what Procrastimate is, who it is for, and the snappy local-first bar.
- [Workflow](workflow.md): how threads, PRs, rebases, tests, and screenshots work.
- [UX principles](ux-principles.md): mobile-first layout, touch, motion, and Liquid Glass parity.
- [Visual language](visual-language.md): the Liquid Glass materials, shapes, motion, accessibility fallbacks, and rendering pick.
- [Theming](theming.md): System, Light, and Dark themes, semantic tokens, and contrast.
- [Domain](domain.md): tasks, views, projects, labels, priorities, and reminders.
- [Quick add and natural language](quick-add.md): the quick add parser, its phrases, guards, and autocomplete.
- [Labels UI](labels.md): how labels show and are edited in rows, the sidebar, and pickers.
- [Settings](settings.md): the sidebar Settings row, its popover or sheet, and what it holds.
- [Todoist import](todoist-import.md): importing a Todoist backup zip, field mapping, nesting, and re-runs.
- [Recurring tasks](recurrence.md): completing, next occurrences, and editing repeats.
- [Search](search.md): matching, ranking, grouping, and the search sheet.
- [Subtasks](subtasks.md): nested child tasks, where they show, completion, reorder, and delete rules.
- [Push notifications](push-notifications.md): Web Push scheduling, delivery, keys, and permission.
- [Stack](stack.md): tooling, client and server frameworks, and shared code.
- [Dev hosting](dev-hosting.md): the dev box, `tailscale serve`, and the single-origin rule.
- [Production hosting](production-hosting.md): the Cloudflare Worker, deploys, and free-tier fit.
- [Persistence and sync](persistence.md): local storage and the future sync log.
- [Testing](testing.md): unit tests, end-to-end tests, and the feature map.
- [iOS app](ios.md): the native SwiftUI app, its architecture, the Swift port and shared test vectors, local notifications, macOS CI, and paired parity tests. Its checklist and thread split are in [iOS parity](../ios-parity.md).
