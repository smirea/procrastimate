# Product goals

- **Personal task manager.** Procrastimate is Stefan's personal task manager. Todoist is a rough functional reference for behavior where these decisions are silent. It is never a visual reference.
- **Its own visual language, based on Liquid Glass.** Procrastimate designs its own look on Apple's Liquid Glass, so the web app and the eventual iOS app look alike and modern. See [Visual language](visual-language.md).
- **One user.** There is exactly one user. No accounts, sharing, roles, or multi-tenant concerns.
- **Platforms.** Web now, iOS later, Apple Watch after iOS.
- **Features are in flux.** Never keep backwards compatibility. Change data shapes, routes, and storage freely, and delete old behavior instead of migrating it.
- **Local first, synced.** Every change applies to local state at once. Remote sync happens in the background and never blocks an interaction.
- **Extremely snappy.** No spinners or visible delays on local data. Every interaction responds on the first frame.
- **Subtle, satisfying animations.** Motion confirms every interaction without slowing it down.
