# Tinycast extension

- A Raycast-format extension that Tinycast loads from `dist/`. `bun run build` (`ray build`) bundles `src/` and everything it imports from `shared/`; only `@raycast/api` and `react` stay external, since Tinycast provides them.
- It talks to the server only through the agent API, with the oRPC client typed by `agentContract`. Never call a route outside `agentContract`: an AI account token gets `403` on anything else, though a personal one would not.
- Use `shared/` for every rule the apps have (views, formatting, search, quick add) instead of restating it here.
- Check what Tinycast's runtime supports before using an `@raycast/api` export: `grep -o 'Name' /Applications/Tinycast.app/Contents/Resources/RaycastRuntime.generated.js`. It has no `@raycast/utils`, `Action.PickDate.isFullDay`, or `Keyboard.Shortcut.Common`.
- `bun run check` typechecks it, and the root `bun run check` includes it.
