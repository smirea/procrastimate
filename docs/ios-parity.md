# iOS parity

Sign-in is the first screen until there is a session. UI tests set PROCRASTINATE_SIGNED_IN so they open the app. What the native iOS app must do to match the web app, row by row from the feature map in `.cursor/skills/verify-procrastimate/features/`, and the threads that build it. The architecture and the reasons behind it are in [iOS app](decisions/ios.md).

## Known item before iOS tests are re-enabled

macOS `core` and `app` stay off until a release ([Workflow](decisions/workflow.md)). When they are turned back on, check this first:

- **#47 App Intents** failed its macOS `app` job on `cursor/ios-app-intents-e717` ([run 38145812810](https://github.com/smirea/procrastimate/actions/runs/38145812810)). The log has no failing XCUITest: the job died in **Build** before tests started. Swift reported that `typeDisplayRepresentation` and `defaultQuery` are not concurrency-safe (`Entities.swift`, `NavigationIntents.swift`, `TaskIntents.swift`), and that `IndexedEntityQuery` and `CSSearchableIndexDescription` are not in scope (`Entities.swift`).

## How to read the checklist

- **Feature** is the feature map's sub-feature id. A row marked *iOS only* is a native affordance with no web counterpart. A row marked *web only* has no iOS equivalent.
- **iOS** is `Planned`, `Built` (merged, parity tests green), or `n/a`. Each slice updates only its own rows.
- **Slice** is the thread that ships the row (see [Thread split](#thread-split)). `S3→S5` means the logic comes from S3 and the UI from S5.
- **XCUITest** and **Playwright** columns are the old scenario ids. Those UI tests are gone. Parser phrases, guards, recurrence math, ranking, and import mapping are proven by the shared test vectors. See [Testing](decisions/testing.md).
- **iOS** `Built` means the feature is in the app. It no longer means a parity test is green.
- **App Intents ship with the feature.** A new iOS feature that someone can do from outside the app includes its App Intents, shortcut phrases, and entities in the same change. The web column stays `n/a`: Siri, Shortcuts, and Spotlight are iOS. See [iOS app](decisions/ios.md#siri-shortcuts-and-spotlight).

## Checklist

### Add a task

| Feature | Web | iOS | Slice | XCUITest | Playwright | Screenshot |
| --- | --- | --- | --- | --- | --- | --- |
| `add-open`: quick add from the add button (and `q` on a hardware keyboard), attached to the keyboard | ✓ | Built (no `q` shortcut yet) | S5 | `QuickAddParityTests.test_add_open` | `quick-add › add-open` | `add-open.png` |
| `add-save`: saves into the current list | ✓ | Built | S5 | `QuickAddParityTests.test_add_save` | `quick-add › add-save` | `add-save.png` |
| `add-due`: a typed due date leaves the title | ✓ | Built | S3→S5 | `QuickAddParityTests.test_add_due` | `quick-add › add-due` | `add-due.png` |
| `add-shorthand`: `tom 5p`, `eow`, `2d`, `5m`, `1730`, `10/15`, `the 15th`, with `Tom` and `sun hat` left as text | ✓ | Built | S3→S5 | `QuickAddParityTests.test_add_shorthand` | `quick-add › add-shorthand` | `add-shorthand.png` |
| `add-recurrence`: `every mon`, `daily`, `every march 2nd`, `mon wed fri 7am`, `tue/thu`, with prose lists left as text | ✓ | Built | S3→S5 | `QuickAddParityTests.test_add_recurrence` | `quick-add › add-recurrence` | `add-recurrence.png` |
| `add-highlight`: inline highlight per parsed phrase, checked on the rendered text while typing | ✓ | Built | S5, Polish | `QuickAddParityTests.test_add_highlight` | `quick-add › add-highlight` | `add-highlight.png` |
| `add-config-row`: the chip row spells out due, repeat, and reminders | ✓ | Built | S5 | `QuickAddParityTests.test_add_config_row` | `quick-add › add-config-row` | `add-config-row.png` |
| `add-keep-text`: `Keep as text` un-parses a phrase | ✓ | Built | S5 | `QuickAddParityTests.test_add_keep_text` | `quick-add › add-keep-text` | `add-keep-text.png` |
| `add-defaults`: project inside a project, today inside Today, label inside a label view | ✓ | Built | S5, S7 | `QuickAddParityTests.test_add_defaults`, with the project and label defaults in `ProjectsParityTests.test_projects_open` and `LabelsParityTests.test_labels_view` | `quick-add › add-defaults` | `add-defaults.png` |
| `add-cancel`: dismissing discards the draft | ✓ | Built | S5 | `QuickAddParityTests.test_add_cancel` | `quick-add › add-cancel` | `add-cancel.png` |
| `add-repeat`: stays open for the next task | ✓ | Built | S5 | `QuickAddParityTests.test_add_repeat` | `quick-add › add-repeat` | `add-repeat.png` |
| `add-create`: an unknown `#name` or `@name` offers `Create #name` or `Create @name` and creates only when picked | ✓ | Built | Polish | `QuickAddParityTests.test_add_create` | `quick-add › add-create` | `add-create.png` |
| `add-dock`: the card sits flush on the keyboard and the add button hides while it is open | ✓ | Built | Polish | `QuickAddParityTests.test_add_dock` | `quick-add › add-dock` | `add-dock.png` |
| `add-toast`: on phones a toast moves above an open quick add, keeps its action on one line, and hides no chips | ✓ | Built (toasts move to the top while quick add is open) | Polish, S8 | covered by `NotificationsParityTests.test_push_nudge` | `quick-add › add-toast` | `add-toast.png` |

### Priority

| Feature | Web | iOS | Slice | XCUITest | Playwright | Screenshot |
| --- | --- | --- | --- | --- | --- | --- |
| `priority-nl`: `p1`–`p4`, `!!!`, `urgent`, `!!`, `important` | ✓ | Built | S3→S5 | `PriorityParityTests.test_priority_nl` | `priority › priority-nl` | `priority-nl.png` |
| `priority-picker`: the flag menu in quick add and task details | ✓ | Built | S5, S6 | `PriorityParityTests.test_priority_picker` | `priority › priority-picker` | `priority-picker.png` |
| `priority-replace`: a picked level removes the typed one | ✓ | Built | S5 | `PriorityParityTests.test_priority_replace` | `priority › priority-replace` | `priority-replace.png` |
| `priority-display`: checkbox tinted by priority | ✓ | Built | S5 | `PriorityParityTests.test_priority_display` | `priority › priority-display` | `priority-display.png` |

### Complete a task

| Feature | Web | iOS | Slice | XCUITest | Playwright | Screenshot |
| --- | --- | --- | --- | --- | --- | --- |
| `complete-check`: checkbox completes and animates out, with a success haptic on iOS | ✓ | Built | S5 | `CompleteParityTests.test_complete_check` | `complete › complete-check` | `complete-check.png` |
| `complete-undo`: the toast's `Undo` restores the row | ✓ | Built | S5 | `CompleteParityTests.test_complete_undo` | `complete › complete-undo` | `complete-undo.png` |
| `complete-swipe`: leading swipe completes (*iOS only*) | n/a | Built | S5 | `CompleteParityTests.test_complete_swipe` | n/a | `complete-swipe.png` |
| `complete-recurring`: moves to the next occurrence with `next due …` toast | ✓ | Built | S5 | `CompleteParityTests.test_complete_recurring` | `complete › complete-recurring` | `complete-recurring.png` |
| `complete-subtasks`: see `subtasks-complete-parent` | ✓ | Built | S6 | see Subtasks | see Subtasks | — |
| `complete-reopen`: `Reopen` in details of a completed task, reached through search | ✓ | Built | S7 | `SearchParityTests.test_search_completed` | `search › search-completed` | `search-completed.png` |
| `complete-history`: a completed tasks list | Planned | Planned | not scheduled | — | — | — |

### Edit a task

| Feature | Web | iOS | Slice | XCUITest | Playwright | Screenshot |
| --- | --- | --- | --- | --- | --- | --- |
| `edit-open`: tapping a row opens the details sheet | ✓ | Built | S6 | `DetailsParityTests.test_edit_open` | `details › edit-open` | `edit-open.png` |
| `edit-fields`: title, notes, date (presets and graphical picker), priority; saved as changed and after relaunch | ✓ | Built | S6 | `DetailsParityTests.test_edit_fields` | `details › edit-fields` | `edit-fields.png` |
| `edit-nl`: phrases in the title apply on return | ✓ | Built | S6 | `DetailsParityTests.test_edit_nl` | `details › edit-nl` | `edit-nl.png` |
| `edit-config-row`: chips show the parsed values before commit | ✓ | Built | S6 | `DetailsParityTests.test_edit_config_row` | `details › edit-config-row` | `edit-config-row.png` |
| `edit-delete`: `Delete task` with undo | ✓ | Built | S6 | `DetailsParityTests.test_edit_delete` | `details › edit-delete` | `edit-delete.png` |
| `edit-swipe-delete`: trailing swipe deletes with undo (*iOS only*) | n/a | Built | S5 | `CompleteParityTests.test_edit_swipe_delete` | n/a | `edit-swipe-delete.png` |

### Subtasks

| Feature | Web | iOS | Slice | XCUITest | Playwright | Screenshot |
| --- | --- | --- | --- | --- | --- | --- |
| `subtasks-add`: `Add subtask` parses like quick add, keeps focus | ✓ | Built | S6 | `SubtasksParityTests.test_subtasks_add` | `subtasks › subtasks-add` | `subtasks-add.png` |
| `subtasks-progress`: ring and `done/total` on parent rows | ✓ | Built | S6 | `SubtasksParityTests.test_subtasks_progress` | `subtasks › subtasks-progress` | `subtasks-progress.png` |
| `subtasks-check`: toggles in the parent's details, no toast | ✓ | Built | S6 | `SubtasksParityTests.test_subtasks_check` | `subtasks › subtasks-check` | `subtasks-check.png` |
| `subtasks-reorder`: drag by handle, with impact haptics on iOS | ✓ | Built | S6 | `SubtasksParityTests.test_subtasks_reorder` | `subtasks › subtasks-reorder` | `subtasks-reorder.png` |
| `subtasks-nest`: pushes the subtask's details with a back button to the parent | ✓ | Built | S6 | `SubtasksParityTests.test_subtasks_nest` | `subtasks › subtasks-nest` | `subtasks-nest.png` |
| `subtasks-complete-parent`: cascades, undo restores each | ✓ | Built | S6 | `SubtasksParityTests.test_subtasks_complete_parent` | `subtasks › subtasks-complete-parent` | `subtasks-complete-parent.png` |
| `subtasks-recurring`: a recurring parent reopens its subtasks | ✓ | Built | S6 | `SubtasksParityTests.test_subtasks_recurring` | `subtasks › subtasks-recurring` | `subtasks-recurring.png` |
| `subtasks-search`: found by its own text, names its parent | ✓ | Built | S7 | `SearchParityTests.test_subtasks_search` | `search › subtasks-search` | `subtasks-search.png` |
| `subtasks-dated`: dated subtasks in Today and Upcoming under their parent | ✓ | Built | S6 | `SubtasksParityTests.test_subtasks_dated` | `subtasks › subtasks-dated` | `subtasks-dated.png` |

### Recurring tasks

| Feature | Web | iOS | Slice | XCUITest | Playwright | Screenshot |
| --- | --- | --- | --- | --- | --- | --- |
| `recurring-nl`: repeats typed in quick add or the title, including weekday lists and yearly dates | ✓ | Built | S3→S5 | covered by `add-recurrence` | covered by `add-recurrence` | — |
| `recurring-picker`: presets, custom interval, weekday toggles that keep the popover open, `Don't repeat` | ✓ | Built | S6 | `RecurringParityTests.test_recurring_picker` | `recurring › recurring-picker` | `recurring-picker.png` |
| `recurring-display`: repeat icon named after the repeat | ✓ | Built | S5 | `RecurringParityTests.test_recurring_display` | `recurring › recurring-display` | `recurring-display.png` |
| `recurring-complete`: see `complete-recurring` | ✓ | Built | S5 | see Complete | see Complete | — |
| `recurring-reminders`: reminders and the due time notify at the next occurrence | ✓ | Built | S8 | `RemindersParityTests.test_recurring_reminders` | `reminders › recurring-reminders` | `recurring-reminders.png` |

### Reminders

| Feature | Web | iOS | Slice | XCUITest | Playwright | Screenshot |
| --- | --- | --- | --- | --- | --- | --- |
| `reminders-nl`: `remind me 30m before`, `r5m`, `remind me at 4pm`, … | ✓ | Built | S3→S5 | `QuickAddParityTests.test_reminders_nl` | `quick-add › reminders-nl` | `reminders-nl.png` |
| `reminders-picker`: presets, custom date and time, remove | ✓ | Built | S6 | `DetailsParityTests.test_reminders_picker` | `details › reminders-picker` | `reminders-picker.png` |
| `reminders-fire`: `Reminder: <title>` toast with `Open` while the app is open | ✓ | Built | S8 | `RemindersParityTests.test_reminders_fire` | `reminders › reminders-fire` | `reminders-fire.png` |
| `reminders-due-time`: the due time notifies alone, a date alone never does, one notification per moment | ✓ | Built | S2→S8 | `RemindersParityTests.test_reminders_due_time` | `reminders › reminders-due-time` | `reminders-due-time.png` |
| `reminders-notify`: system notifications while closed (Web Push on web, local notifications on iOS) | ✓ | Built | S8 | see Notifications | see Notifications | — |

### Notifications

The web's Web Push rows map to native local notifications. Permission is asked on first launch. Settings has one line, and there is no Notifications screen. The web halves stand in for the push service and read the server's schedule as `title@<ISO time>: body` lines.

| `push-sheet`: Settings shows `Notifications: On`, `Notifications: Off`, or `Notifications need permission` | ✓ | Built | S8 | `NotificationsParityTests.test_push_sheet` | `notifications › push-sheet` | `push-sheet.png` |
| `push-permission`: the app asks on first launch; a denial is the tappable settings line | ✓ | Built | S8 | `NotificationsParityTests.test_push_permission` | `notifications › push-permission` | `push-permission.png` |
| `push-install`: no Add to Home Screen prompt | — | n/a | — | — | — | — |
| `push-schedule`: the device schedule equals future due times and reminders of open tasks, at most 60 pending on iOS | ✓ | Built | S8 | `NotificationsParityTests.test_push_schedule` | `notifications › push-schedule` | `push-schedule.png` |
| `push-deliver`: one notification per moment, titled with the task, body such as `Due now` | ✓ | Built | S8 | `NotificationsParityTests.test_push_deliver` | `notifications › push-deliver` | `push-deliver.png` |
| `push-test`: settings has the notifications line and no turn-on prompt | ✓ | Built | S8 | — | `notifications › push-test` | `push-test.png` |
| `push-nudge`: saving a timed task shows no turn-on toast | ✓ | Built | S8 | `NotificationsParityTests.test_push_nudge` | `notifications › push-nudge` | — |
| `push-open`: tapping a notification opens its task | ✓ | Built (opens the details sheet; S6 fills it in) | S8 | `NotificationsParityTests.test_push_open` | `notifications › push-open` | `push-open.png` |

### Task views

| Feature | Web | iOS | Slice | XCUITest | Playwright | Screenshot |
| --- | --- | --- | --- | --- | --- | --- |
| `shell-launch`: the app opens on an empty Inbox (pipeline smoke pair) | ✓ | Built | S1 | `ShellParityTests.test_shell_launch` | `shell › shell-launch` | `shell-launch.png` |
| `views-inbox`: top-level tasks without a project | ✓ | Built | S5 | `ViewsParityTests.test_views_inbox` | `views › views-inbox` | `views-inbox.png` |
| `views-today`: due today, overdue in its own section | ✓ | Built | S5 | `ViewsParityTests.test_views_today` | `views › views-today` | `views-today.png` |
| `views-upcoming`: grouped by day | ✓ | Built | S5 | `ViewsParityTests.test_views_upcoming` | `views › views-upcoming` | `views-upcoming.png` |
| `views-empty`: `Inbox zero`, `All clear for today`, `Nothing scheduled` | ✓ | Built | S5 | `ViewsParityTests.test_views_empty` | `views › views-empty` | `views-empty.png` |
| `views-counts`: open counts (sidebar on web, tab badges and Browse on iOS) | ✓ | Built | S5 | `ViewsParityTests.test_views_counts` | `views › views-counts` | `views-counts.png` |
| `views-canvas`: lists sit on the tinted canvas, rows stay transparent | ✓ | Built | Polish | `ViewsParityTests.test_views_canvas` | `views › views-canvas` | `views-canvas.png` |

### Projects

| Feature | Web | iOS | Slice | XCUITest | Playwright | Screenshot |
| --- | --- | --- | --- | --- | --- | --- |
| `projects-create`: `Add project` in Browse | ✓ | Built | S7 | `ProjectsParityTests.test_projects_create` | `projects › projects-create` | `projects-create.png` |
| `projects-open`: a project lists its tasks | ✓ | Built | S7 | `ProjectsParityTests.test_projects_open` | `projects › projects-open` | `projects-open.png` |
| `projects-assign`: `#Name` in quick add | ✓ | Built | S3→S5 | `QuickAddParityTests.test_projects_assign` | `quick-add › projects-assign` | `projects-assign.png` |
| `projects-autocomplete`: `#` suggestions with order, create row, and keys | ✓ | Built (keys not covered by XCUITest) | S5 | `QuickAddParityTests.test_projects_autocomplete` | `quick-add › projects-autocomplete` | `projects-autocomplete.png` |
| `projects-move`: project menu in task details | ✓ | Built | S6 | `DetailsParityTests.test_projects_move` | `details › projects-move` | `projects-move.png` |
| `projects-rename`: from the project's toolbar menu | ✓ | Built | S7 | `ProjectsParityTests.test_projects_rename` | `projects › projects-rename` | `projects-rename.png` |
| `projects-delete`: confirms with the task count and deletes the tasks | ✓ | Built | S7 | `ProjectsParityTests.test_projects_delete` | `projects › projects-delete` | `projects-delete.png` |

### Labels

| Feature | Web | iOS | Slice | XCUITest | Playwright | Screenshot |
| --- | --- | --- | --- | --- | --- | --- |
| `labels-type`: `@name` adds labels, emails and handles stay text | ✓ | Built | S3→S5 | `QuickAddParityTests.test_labels_type` | `quick-add › labels-type` | `labels-type.png` |
| `labels-autocomplete`: `@` suggestions and create row | ✓ | Built | S5 | `QuickAddParityTests.test_labels_autocomplete` | `quick-add › labels-autocomplete` | `labels-autocomplete.png` |
| `labels-keep-text`: `Keep as text` on a label chip | ✓ | Built | S5 | `QuickAddParityTests.test_labels_keep_text` | `quick-add › labels-keep-text` | `labels-keep-text.png` |
| `labels-chips`: chips on rows | ✓ | Built | S5 | `ViewsParityTests.test_labels_chips` | `views › labels-chips` | `labels-chips.png` |
| `labels-picker`: toggle and create in a popover that stays open | ✓ | Built | S6 | `DetailsParityTests.test_labels_picker` | `details › labels-picker` | `labels-picker.png` |
| `labels-view`: every open task with the label, naming its project | ✓ | Built | S7 | `LabelsParityTests.test_labels_view` | `labels › labels-view` | `labels-view.png` |
| `labels-rename`: unique ignoring case | ✓ | Built | S7 | `LabelsParityTests.test_labels_rename` | `labels › labels-rename` | `labels-rename.png` |
| `labels-delete`: keeps the tasks | ✓ | Built | S7 | `LabelsParityTests.test_labels_delete` | `labels › labels-delete` | `labels-delete.png` |
| `labels-search`: label results open the label view | ✓ | Built | S7 | `SearchParityTests.test_labels_search` | `search › labels-search` | `labels-search.png` |

### Search

| Feature | Web | iOS | Slice | XCUITest | Playwright | Screenshot |
| --- | --- | --- | --- | --- | --- | --- |
| `search-open`: the search tab (and `/` or Cmd-K on a hardware keyboard) | ✓ | Built (Cmd-K, not covered by XCUITest; `/` stays web only, see [iOS app](decisions/ios.md#ui-mapping)) | S7 | `SearchParityTests.test_search_open` | `search › search-open` | `search-open.png` |
| `search-match`: titles, notes, projects, labels; every word; accents ignored | ✓ | Built | S4→S7 | `SearchParityTests.test_search_match` | `search › search-match` | `search-match.png` |
| `search-rank`: field weights and word-start bonus | ✓ | Built | S4→S7 | covered by `search-match` | covered by `search-match` | — |
| `search-highlight`: matched spans in titles, excerpts, names, chips | ✓ | Built | S7 | `SearchParityTests.test_search_highlight` | `search › search-highlight` | `search-highlight.png` |
| `search-keyboard`: Up, Down, Enter, Escape (iPad hardware keyboard on iOS) | ✓ | Built (Return; iPad Up and Down not covered by XCUITest) | S7 | `SearchParityTests.test_search_keyboard` | `search › search-keyboard` | `search-keyboard.png` |
| `search-open-result`: task opens details, project or label navigates | ✓ | Built | S7 | `SearchParityTests.test_search_open_result` | `search › search-open-result` | `search-open-result.png` |
| `search-completed`: `Completed` group and `Reopen` | ✓ | Built | S7 | `SearchParityTests.test_search_completed` | `search › search-completed` | `search-completed.png` |
| `search-empty`: `No results for "<query>"` | ✓ | Built | S7 | `SearchParityTests.test_search_empty` | `search › search-empty` | `search-empty.png` |

### Settings and theme

| Feature | Web | iOS | Slice | XCUITest | Playwright | Screenshot |
| --- | --- | --- | --- | --- | --- | --- |
| `settings-popover`: the desktop sidebar's settings popover (*web only*) | ✓ | n/a | — | — | — | — |
| `settings-sheet`: Settings in Browse (the phone web's settings sheet) | ✓ | Built | S8 | `SettingsParityTests.test_settings_sheet` | `settings › settings-sheet` | `settings-sheet.png` |
| `settings-theme`: the `Theme` segmented control | ✓ | Built | S8 | `SettingsParityTests.test_settings_theme` | `settings › settings-theme` | `settings-theme.png` |
| `settings-dictation`: `Dictation` with `Native` and `ElevenLabs`, `Native` until changed, kept while Settings is closed | ✓ | Built | — | `SettingsParityTests.test_settings_dictation` | `settings › settings-dictation` | `settings-dictation.png` |
| `settings-import`: `Import from Todoist` | ✓ | Built | S8 | see Todoist import | see Todoist import | — |
| `theme-system`: follows the device appearance live | ✓ | Built | S8 | `ThemeParityTests.test_theme_system` (light only: the CI simulator ignores `XCUIDevice.shared.appearance`) | `theme › theme-system` | `theme-system-light.png`, `theme-system-dark.png` (web) |
| `theme-override`: `Light` and `Dark` | ✓ | Built | S8 | `ThemeParityTests.test_theme_override` | `theme › theme-override` | `theme-override.png` |
| `theme-persist`: kept across relaunch, outside task data | ✓ | Built | S8 | `ThemeParityTests.test_theme_persist` | `theme › theme-persist` | `theme-persist.png` |
| `theme-first-paint`: no flash of the other theme at launch | ✓ | Built | S8 | `ThemeParityTests.test_theme_first_paint` | `theme › theme-first-paint` | — |
| `theme-contrast`: tokens generated from `index.css`, which the web contrast test checks | ✓ | Built | S1 | n/a (`Tokens.swift` freshness check in CI) | n/a | — |
| `theme-glass-fallback`: solid glass under Increase Contrast or Reduce Transparency | ✓ | Built (system glass) | S8 | n/a: a UI test cannot change the setting | n/a (`theme.e2e.ts` in `desktop`) | — |
| `theme-reduced-motion`: instant motion under Reduce Motion | ✓ | Built | S8 | n/a: a UI test cannot change the setting | n/a (`theme.e2e.ts` in `desktop`) | — |

### Todoist import

| Feature | Web | iOS | Slice | XCUITest | Playwright | Screenshot |
| --- | --- | --- | --- | --- | --- | --- |
| `import-pick`: file picker limited to `.zip` (plus "Open in Procrastimate" on iOS) | ✓ | Built (no XCUITest for opening a zip into the app) | S8 | `ImportParityTests.test_import_pick` | `import › import-pick` | `import-pick.png` |
| `import-read`: projects, Inbox, labels, nesting, notes, reminders | ✓ | Built | S4→S8 | `ImportParityTests.test_import_read` | `import › import-read` | `import-read.png` |
| `import-dates`: Todoist dates through the parser, unreadable ones in notes | ✓ | Built | S4→S8 | covered by `import-read` | covered by `import-read` | — |
| `import-summary`: counts and warnings | ✓ | Built | S8 | `ImportParityTests.test_import_summary` | `import › import-summary` | `import-summary.png` |
| `import-dedupe`: a second import adds nothing | ✓ | Built | S8 | `ImportParityTests.test_import_dedupe` | `import › import-dedupe` | `import-dedupe.png` |
| `import-error`: a non-backup file changes nothing | ✓ | Built | S8 | `ImportParityTests.test_import_error` | `import › import-error` | `import-error.png` |

### Offline and sync

| Feature | Web | iOS | Slice | XCUITest | Playwright | Screenshot |
| --- | --- | --- | --- | --- | --- | --- |
| `sync-offline`: everything works with no network; the local store is the UI | ✓ | Built | S5 | true by construction | — | — |
| `sync-propagate`, `sync-realtime`, `sync-reconnect`, `sync-conflict`: changes reach the other client, offline changes upload, concurrent edits converge per [Sync](decisions/sync.md#conflicts) | ✓ | Built (Core client; no XCUITest of two devices) | Y4, S9 | `swift test` (`SyncEngine`, `StoreTests`) | `sync.e2e.ts` | — |
| `sync-delete`: Settings `Delete all data` wipes tasks, projects, and labels on this device and the server | ✓ | Built | — | `SettingsParityTests` shows the button | `sync.e2e.ts` | — |

### Ramble

Built on web and iOS. The grammar is covered by `shared/vectors/ramble.json` and Linux `VectorTests`. The trimmed suite does not add a Ramble UI test. Cassettes and the optional LLM step are not built. The design is in [Ramble design](ramble-design.md#plan-and-slices).

| Feature | Web | iOS | Slice | XCUITest | Playwright | Screenshot |
| --- | --- | --- | --- | --- | --- | --- |
| `ramble-open`: the quick add mic, a long-press on the add button, and Shift+Q open Ramble | Built | Built | R4, R5 | — | — | — |
| `ramble-live`: the transcript and task cards appear while talking | Built | Built | R4, R5 | — | — | — |
| `ramble-chips`: spoken project, label, date, repeat, priority, and reminder show as chips | Built | Built | R4, R5 | — | — | — |
| `ramble-subtasks`: spoken subtasks nest under their parent | Built | Built | R4, R5 | — | — | — |
| `ramble-notes`: a spoken note goes under the title | Built | Built | R4, R5 | — | — | — |
| `ramble-plain`: a ramble with no metadata yields chip-free cards | Built | Built | R4, R5 | — | — | — |
| `ramble-edit`: a card's title and date are edited before saving | Built | Built | R4, R5 | — | — | — |
| `ramble-discard`: a card is discarded and restored with `Undo` | Built | Built | R4, R5 | — | — | — |
| `ramble-save-undo`: `Add <n> tasks` saves them all, and one `Undo` removes them | Built | Built | R4, R5 | — | — | — |
| `ramble-hold`: hold to talk listens while held | Built | Built | R4, R5 | — | — | — |
| `ramble-unavailable`: a missing ElevenLabs key or a refused socket explains why that path is off; offline uses native dictation | Built | Built | R4, R5 | — | — | — |

### Siri, Shortcuts, and Spotlight

iOS only. The web client has no App Intents. New features that can be done from outside the app add their rows here in the same change. See [iOS app](decisions/ios.md#siri-shortcuts-and-spotlight).

| Feature | Web | iOS | Slice | XCUITest | Playwright | Screenshot |
| --- | --- | --- | --- | --- | --- | --- |
| `intent-add`: Add Task parses the quick-add grammar, and Shortcuts fields fill only what the title left unset | n/a | Built | Intents | `AppIntentsParityTests.test_intent_add`, `test_intent_project_labels_and_parameters` | n/a | — |
| `intent-complete`: completes the open task with that title | n/a | Built | Intents | `AppIntentsParityTests.test_intent_complete_and_spotlight` | n/a | — |
| `intent-reopen`: reopens a completed task | n/a | Built | Intents | `AppIntentsParityTests.test_intent_reopen` | n/a | — |
| `intent-open-view`: opens Inbox, Today, or Upcoming | n/a | Built | Intents | `AppIntentsParityTests.test_intent_open_views` | n/a | — |
| `intent-open-project`: opens a project | n/a | Built | Intents | `AppIntentsParityTests.test_intent_project_labels_and_parameters` | n/a | — |
| `intent-open-task`: opens a task | n/a | Built | Intents | `AppIntentsParityTests.test_intent_open_task` | n/a | — |
| `intent-search`: searches tasks and shows the matches | n/a | Built | Intents | `AppIntentsParityTests.test_intent_search` | n/a | — |
| `intent-today`: lists tasks due today | n/a | Built | Intents | `AppIntentsParityTests.test_intent_today_and_overdue` | n/a | — |
| `intent-overdue`: lists overdue tasks | n/a | Built | Intents | `AppIntentsParityTests.test_intent_today_and_overdue` | n/a | — |
| `intent-spotlight`: Spotlight indexes open tasks and drops them once completed | n/a | Built | Intents | `AppIntentsParityTests.test_intent_complete_and_spotlight` | n/a | — |
| `intent-delete-all`: deletes every task, project, and label | n/a | Built | Intents | — | n/a | — |
| `intent-ramble`: Start Ramble opens the sheet and starts listening | n/a | Built | R5 | — | n/a | — |

## Thread split

One PR per slice, each off `master`, never stacked. A slice starts once the slices it depends on have merged.

| Slice | Thread | Depends on | Runs in parallel with |
| --- | --- | --- | --- |
| S1 | Scaffold and macOS CI | — | — |
| S2 | Core model, store rules, and vectors | S1 | — |
| S3 | Parser port | S2 | S4 |
| S4 | Search and import logic port | S2 | S3, S5 |
| S5 | Lists and quick add | S3 | S4 |
| S6 | Task details, subtasks, recurrence | S5 | S7, S8 |
| S7 | Projects, labels, and search UI | S4, S5 | S6, S8 |
| S8 | Settings, theme, import, notifications | S4, S5 (S6 for `push-open`) | S6, S7 |
| S9 | iOS sync client | S8, Y3, Y4 | Y5, Y6 |
| Polish | Quick add and list polish from the side-by-side run | S5 | S6, S8 |

Critical path: S1 → S2 → S3 → S5 → S6, S7, and S8 together, then S9. The sync slices `Y1` to `Y6` interleave with these as listed in [Sync build slices](sync-slices.md): Y1 and Y2 run alongside S1 and S2, and the web client Y4 waits for S2.

**Conflict rules.** S1 creates every shared seam up front: the `Core`, `CoreTests`, `App`, and `AppUITests` targets, `RootView` with every tab, a `Route` enum for every destination, a `Sheet` enum for quick add, details, search, and settings, and one placeholder file per screen. Later slices replace the placeholder files they own and add files under their own folders, so no two parallel slices edit the same file. `project.pbxproj` only changes in S1, because every target is a synchronized folder. Each slice edits only its own rows here and its own feature map files. Workflows change only in S1 and S2, which run one after the other.

- **S1: Scaffold and macOS CI.**
  - Raise the deployment target to iOS 26 and drop the macOS app target.
  - Add the `Core` library, `Tests/CoreTests`, and the `AppUITests` target, plus `RootView` with tabs, the `Route` and `Sheet` enums, and placeholder screens.
  - Add the DEBUG launch environment (pinned clock, zone, fresh store), a `snap("<parity-id>")` screenshot helper on both sides, and the `Tokens.swift` generator from `index.css`.
  - Add `.github/workflows/ios.yml` with the `core`, `core-linux`, `app`, `web-parity`, and `parity-report` jobs, the Playwright `parity` project, and `app-web/e2e/parity/` with a shared fixture.
  - One smoke pair (`shell-launch`: the app opens on an empty Inbox) proves the whole pipeline and the side-by-side report.
  - Update `app-ios/AGENTS.md` and `README.md`.
- **S2: Core model, store rules, and vectors.**
  - Move `views.ts`, `format.ts`, the notification text from `push-schedule.ts`, and the store's domain rules into `shared/`, with the web importing them and its behavior unchanged.
  - Add `shared/vectors/record.ts`, `bun run vectors`, and the vectors staleness step in `ci.yml`'s `checks` job.
  - Port the model and the snapshot Codable (with the web snapshot vector), dates, recurrence, `notificationTimes`, subtasks, views, format, and the store rules to `Core`, plus `VectorTests`.
- **S3: Parser port.** The quick add parser in `Core` as `QuickAdd`, checked against `shared/vectors/quick-add.json`, recorded from `quick-add.test.ts`. Name search (`#` and `@` suggestion order) moved to S4. The parser rows marked `S3→S5` stay `Planned` until S5 adds their UI tests.
- **S4: Search and import logic port.** `search`, `excerpt`, name search (`#` and `@` suggestion order, moved here from S3), the CSV reader, and the Todoist reader and merge in `Core`, with vectors from `search.test.ts`, `name-search.test.ts`, `csv.test.ts`, and `todoist.test.ts`, including the synthetic backup. Todoist date phrases go through S3's `QuickAdd`. The zip reader goes in `App` under S8, because it needs Apple's `Compression` framework.
- **S5: Lists and quick add.**
  - The JSON file store, in the sync document shape with an empty `sync` section, tasks sorted by `createdAt` then `id`, and every command through one `commit(next)` (see [iOS app](decisions/ios.md#data)).
  - The Inbox, Today, Upcoming, and project or label list rendering, task rows with chips and the repeat icon, checkbox and swipe completion, swipe delete, the undo toast, and tab badges.
  - The quick add sheet with the shared smart input (highlighting, chip row, `Keep as text`, `#` and `@` suggestions), quick add's date, priority, and project chips, and haptics for all of these.
- **S6: Task details, subtasks, recurrence.** The details sheet and its `NavigationStack`, title parsing, notes, and the date, priority, project, labels, repeat, and reminder pickers, plus delete. Subtasks: add, check, drag reorder, nest, and the parent cascade.
- **S7: Projects, labels, and search UI.** The Browse tab's projects and labels with counts, project and label screens with rename and delete, and the search tab with groups, highlights, completed tasks, `Reopen`, and hardware keyboard shortcuts.
- **S8: Settings, theme, import, notifications.**
  - The Settings screen with the theme control and accessibility fallbacks, and Todoist import (the `Compression`-based zip reader plus the picker), using the fixture CI copies in.
  - Local notifications: the scheduler with a 60-request window, background refresh, the foreground toast, the permission screen, the nudge, a test notification, and opening a task from its notification.
- **S9: iOS sync client.** The client half of [Sync](decisions/sync.md) on top of S5's store, as scoped in [Sync build slices](sync-slices.md).
- **Polish: Quick add and list polish.** Fixes from the side-by-side run: the typed-token tint on iOS, `Create #name` and `Create @name` chips on both clients, the iOS card attached to the keyboard with the add button hidden, the tinted list canvas on iOS, and phone toasts that no longer cover the quick add chips.
