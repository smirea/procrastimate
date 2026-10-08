# Procrastimate

Procrastimate is a personal task manager for Stefan, loosely modeled on Todoist. It starts small and will grow well beyond a todo list. This file is the live design document for the whole app. Agents read it to understand how the app should behave and to QA it end to end.

## Design goals

- **One user.** Stefan is the only user. Build for him, not for teams, sharing, or onboarding.
- **Many clients.** Web and iOS now, Apple Watch later.
- **Local first, synced.** Every client works from local data and syncs with the server in the background. The app never waits on the network to respond to input.
- **Snappy.** Every interaction responds instantly. Treat any visible lag as a bug.
- **Satisfying motion.** Animations are subtle, quick, and polished. They confirm what happened without slowing the user down.
- **No backwards compatibility.** Features change often. Replace old behavior, data shapes, and APIs outright instead of keeping them alive.

## Features

The app shows a hello screen today. It has no features yet.

Each feature gets a short entry here: one or two sentences on what it does and a link to its feature file. The feature file is `docs/feature_<name-kebab-case>.md`, for example `docs/feature_quick-add.md`.

A feature file describes behavior, not implementation. It covers:

- What the user can do and where they do it, on each client.
- Each interaction step by step, with the expected result and the animation.
- Edge cases and empty, error, and offline states.
- How the feature syncs across clients.

Write it so an agent can follow it as a QA script and confirm the feature works end to end.
