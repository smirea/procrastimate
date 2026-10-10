# Persistence and sync

- **Source keys.** A task or project brought in by an import stores where it came from, such as `todoist:task:…`, so the import can skip what it already brought in. Other tasks have none.
- **Web persistence.** The whole store is one JSON document in `localStorage`, validated on load and written synchronously on every change. Invalid stored data is discarded, since there is no backwards compatibility. A task that fails validation is dropped on its own, so one bad task never wipes the rest of the store. A newly added optional field gets a default during validation instead, so adding it does not wipe the tasks already stored in production.
- **iOS persistence.** The native app stores the same snapshot shape as one JSON file on the device, with no sync. See [iOS app](ios.md).
- **Sync.** Not built yet. The store's mutations are discrete commands so they can become a sync log later.
