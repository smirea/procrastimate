# Product goals

- **Personal task manager.** ProcrastiMate is Stefan's personal task manager. Todoist is a rough functional reference for behavior where these decisions are silent. It is never a visual reference.
- **The name is ProcrastiMate.** Every user-facing string spells it `ProcrastiMate`, never `Procrastimate` or `Procrastinate`. Identifiers such as the domain, bundle id, headers, and env keys stay lowercase or as they are.
- **Its own visual language, based on Liquid Glass.** ProcrastiMate designs its own look on Apple's Liquid Glass, so the web app and the eventual iOS app look alike and modern. See [Visual language](visual-language.md).
- **Many users, one today.** ProcrastiMate is a multi-user app with accounts, sharing, and AI accounts. Until it launches Stefan is its only user, so designs may favor one user's numbers but never assume a single user.
- **Platforms.** Web now, iOS later, Apple Watch after iOS.
- **Features are in flux.** Never keep backwards compatibility. Change data shapes, routes, and storage freely, and delete old behavior instead of migrating it.
- **Local first, synced.** Every change applies to local state at once. Remote sync happens in the background and never blocks an interaction.
- **Extremely snappy.** No spinners or visible delays on local data. Every interaction responds on the first frame.
- **Subtle, satisfying animations.** Motion confirms every interaction without slowing it down.
- **Not building Todoist's deadlines or durations.** The due date is the deadline, and reminders give the earlier pings Todoist's separate deadline field exists for. Sections are built (see [Sections](sections.md)), because Todoist backups carry them and a label cannot say where a task sits inside one project. Durations are covered differently: a task set `During` a calendar event or `While at` a place takes its time span from that, and a Live Activity shows `During` tasks while they run (for places today). Ramble and quick add parse neither.
