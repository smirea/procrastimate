# iOS parity

What the native iOS app must do to match the web app, row by row from the feature map in `.cursor/skills/verify-procrastimate/features/`, and the threads that build it. The architecture and the reasons behind it are in [iOS app](decisions/ios.md).

## How to read the checklist

- **Feature** is the feature map's sub-feature id. A row marked _iOS only_ is a native affordance with no web counterpart. A row marked _web only_ has no iOS equivalent.
- **iOS** is `Planned`, `Built` (merged, parity tests green), or `n/a`. Each slice updates only its own rows.
- **Slice** is the thread that ships the row (see [Thread split](#thread-split)). `S3→S5` means the logic comes from S3 and the UI from S5.
- **XCUITest** is a method in `app-ios/Tests/AppUITests/<Class>.swift`.
- **Playwright** is `<file> › <id>`: the test titled `<id>: …` in `app-web/e2e/parity/<file>.e2e.ts`, run by the `parity` project (WebKit, iPhone 15 Pro). The web column only tracks whether the feature exists on the web; its existing proof stays in the feature map.
- **Screenshot** is the file both sides save: `app-web/test-results/parity/<file>` on the web and `<file>` in the `ios-parity` CI artifact on iOS. The `parity-report` artifact shows each pair side by side.
- Both tests in a row seed the same data through quick add, pin the clock to Wednesday, October 14 2026, 10:00 UTC, perform the same steps, and assert the same accessible names and visible strings. Parser phrases, guards, recurrence math, ranking, and import mapping are proven case by case by the shared test vectors, so their UI rows run one representative scenario.

## Checklist

### Add a task

| Feature                                                                                                                | Web | iOS     | Slice | XCUITest                                  | Playwright                   | Screenshot           |
| ---------------------------------------------------------------------------------------------------------------------- | --- | ------- | ----- | ----------------------------------------- | ---------------------------- | -------------------- |
| `add-open`: quick add from the add button (and `q` on a hardware keyboard), docked above the keyboard                  | ✓   | Planned | S5    | `QuickAddParityTests.test_add_open`       | `quick-add › add-open`       | `add-open.png`       |
| `add-save`: saves into the current list                                                                                | ✓   | Planned | S5    | `QuickAddParityTests.test_add_save`       | `quick-add › add-save`       | `add-save.png`       |
| `add-due`: a typed due date leaves the title                                                                           | ✓   | Planned | S3→S5 | `QuickAddParityTests.test_add_due`        | `quick-add › add-due`        | `add-due.png`        |
| `add-shorthand`: `tom 5p`, `eow`, `2d`, `5m`, `1730`, `10/15`, `the 15th`, with `Tom` and `sun hat` left as text       | ✓   | Planned | S3→S5 | `QuickAddParityTests.test_add_shorthand`  | `quick-add › add-shorthand`  | `add-shorthand.png`  |
| `add-recurrence`: `every mon`, `daily`, `every march 2nd`, `mon wed fri 7am`, `tue/thu`, with prose lists left as text | ✓   | Planned | S3→S5 | `QuickAddParityTests.test_add_recurrence` | `quick-add › add-recurrence` | `add-recurrence.png` |
| `add-highlight`: inline highlight per parsed phrase                                                                    | ✓   | Planned | S5    | `QuickAddParityTests.test_add_highlight`  | `quick-add › add-highlight`  | `add-highlight.png`  |
| `add-config-row`: the chip row spells out due, repeat, and reminders                                                   | ✓   | Planned | S5    | `QuickAddParityTests.test_add_config_row` | `quick-add › add-config-row` | `add-config-row.png` |
| `add-keep-text`: `Keep as text` un-parses a phrase                                                                     | ✓   | Planned | S5    | `QuickAddParityTests.test_add_keep_text`  | `quick-add › add-keep-text`  | `add-keep-text.png`  |
| `add-defaults`: project inside a project, today inside Today, label inside a label view                                | ✓   | Planned | S5    | `QuickAddParityTests.test_add_defaults`   | `quick-add › add-defaults`   | `add-defaults.png`   |
| `add-cancel`: dismissing discards the draft                                                                            | ✓   | Planned | S5    | `QuickAddParityTests.test_add_cancel`     | `quick-add › add-cancel`     | `add-cancel.png`     |
| `add-repeat`: stays open for the next task                                                                             | ✓   | Planned | S5    | `QuickAddParityTests.test_add_repeat`     | `quick-add › add-repeat`     | `add-repeat.png`     |

### Priority

| Feature                                                        | Web | iOS     | Slice  | XCUITest                                    | Playwright                    | Screenshot             |
| -------------------------------------------------------------- | --- | ------- | ------ | ------------------------------------------- | ----------------------------- | ---------------------- |
| `priority-nl`: `p1`–`p4`, `!!!`, `urgent`, `!!`, `important`   | ✓   | Planned | S3→S5  | `PriorityParityTests.test_priority_nl`      | `priority › priority-nl`      | `priority-nl.png`      |
| `priority-picker`: the flag menu in quick add and task details | ✓   | Planned | S5, S6 | `PriorityParityTests.test_priority_picker`  | `priority › priority-picker`  | `priority-picker.png`  |
| `priority-replace`: a picked level removes the typed one       | ✓   | Planned | S5     | `PriorityParityTests.test_priority_replace` | `priority › priority-replace` | `priority-replace.png` |
| `priority-display`: checkbox tinted by priority                | ✓   | Planned | S5     | `PriorityParityTests.test_priority_display` | `priority › priority-display` | `priority-display.png` |

### Complete a task

| Feature                                                                             | Web     | iOS     | Slice         | XCUITest                                      | Playwright                      | Screenshot               |
| ----------------------------------------------------------------------------------- | ------- | ------- | ------------- | --------------------------------------------- | ------------------------------- | ------------------------ |
| `complete-check`: checkbox completes and animates out, with a success haptic on iOS | ✓       | Planned | S5            | `CompleteParityTests.test_complete_check`     | `complete › complete-check`     | `complete-check.png`     |
| `complete-undo`: the toast's `Undo` restores the row                                | ✓       | Planned | S5            | `CompleteParityTests.test_complete_undo`      | `complete › complete-undo`      | `complete-undo.png`      |
| `complete-swipe`: leading swipe completes (_iOS only_)                              | n/a     | Planned | S5            | `CompleteParityTests.test_complete_swipe`     | n/a                             | `complete-swipe.png`     |
| `complete-recurring`: moves to the next occurrence with `next due …` toast          | ✓       | Planned | S5            | `CompleteParityTests.test_complete_recurring` | `complete › complete-recurring` | `complete-recurring.png` |
| `complete-subtasks`: see `subtasks-complete-parent`                                 | ✓       | Planned | S6            | see Subtasks                                  | see Subtasks                    | —                        |
| `complete-reopen`: `Reopen` in details of a completed task, reached through search  | ✓       | Planned | S7            | `SearchParityTests.test_search_completed`     | `search › search-completed`     | `search-completed.png`   |
| `complete-history`: a completed tasks list                                          | Planned | Planned | not scheduled | —                                             | —                               | —                        |

### Edit a task

| Feature                                                                                                         | Web | iOS     | Slice | XCUITest                                     | Playwright                  | Screenshot              |
| --------------------------------------------------------------------------------------------------------------- | --- | ------- | ----- | -------------------------------------------- | --------------------------- | ----------------------- |
| `edit-open`: tapping a row opens the details sheet                                                              | ✓   | Planned | S6    | `DetailsParityTests.test_edit_open`          | `details › edit-open`       | `edit-open.png`         |
| `edit-fields`: title, notes, date (presets and graphical picker), priority; saved as changed and after relaunch | ✓   | Planned | S6    | `DetailsParityTests.test_edit_fields`        | `details › edit-fields`     | `edit-fields.png`       |
| `edit-nl`: phrases in the title apply on return                                                                 | ✓   | Planned | S6    | `DetailsParityTests.test_edit_nl`            | `details › edit-nl`         | `edit-nl.png`           |
| `edit-config-row`: chips show the parsed values before commit                                                   | ✓   | Planned | S6    | `DetailsParityTests.test_edit_config_row`    | `details › edit-config-row` | `edit-config-row.png`   |
| `edit-delete`: `Delete task` with undo                                                                          | ✓   | Planned | S6    | `DetailsParityTests.test_edit_delete`        | `details › edit-delete`     | `edit-delete.png`       |
| `edit-swipe-delete`: trailing swipe deletes with undo (_iOS only_)                                              | n/a | Planned | S5    | `CompleteParityTests.test_edit_swipe_delete` | n/a                         | `edit-swipe-delete.png` |

### Subtasks

| Feature                                                                        | Web | iOS     | Slice | XCUITest                                            | Playwright                            | Screenshot                     |
| ------------------------------------------------------------------------------ | --- | ------- | ----- | --------------------------------------------------- | ------------------------------------- | ------------------------------ |
| `subtasks-add`: `Add subtask` parses like quick add, keeps focus               | ✓   | Planned | S6    | `SubtasksParityTests.test_subtasks_add`             | `subtasks › subtasks-add`             | `subtasks-add.png`             |
| `subtasks-progress`: ring and `done/total` on parent rows                      | ✓   | Planned | S6    | `SubtasksParityTests.test_subtasks_progress`        | `subtasks › subtasks-progress`        | `subtasks-progress.png`        |
| `subtasks-check`: toggles in the parent's details, no toast                    | ✓   | Planned | S6    | `SubtasksParityTests.test_subtasks_check`           | `subtasks › subtasks-check`           | `subtasks-check.png`           |
| `subtasks-reorder`: drag by handle, with impact haptics on iOS                 | ✓   | Planned | S6    | `SubtasksParityTests.test_subtasks_reorder`         | `subtasks › subtasks-reorder`         | `subtasks-reorder.png`         |
| `subtasks-nest`: pushes the subtask's details with a back button to the parent | ✓   | Planned | S6    | `SubtasksParityTests.test_subtasks_nest`            | `subtasks › subtasks-nest`            | `subtasks-nest.png`            |
| `subtasks-complete-parent`: cascades, undo restores each                       | ✓   | Planned | S6    | `SubtasksParityTests.test_subtasks_complete_parent` | `subtasks › subtasks-complete-parent` | `subtasks-complete-parent.png` |
| `subtasks-recurring`: a recurring parent reopens its subtasks                  | ✓   | Planned | S6    | `SubtasksParityTests.test_subtasks_recurring`       | `subtasks › subtasks-recurring`       | `subtasks-recurring.png`       |
| `subtasks-search`: found by its own text, names its parent                     | ✓   | Planned | S7    | `SearchParityTests.test_subtasks_search`            | `search › subtasks-search`            | `subtasks-search.png`          |
| `subtasks-dated`: dated subtasks in Today and Upcoming under their parent      | ✓   | Planned | S6    | `SubtasksParityTests.test_subtasks_dated`           | `subtasks › subtasks-dated`           | `subtasks-dated.png`           |

### Recurring tasks

| Feature                                                                                                  | Web | iOS     | Slice | XCUITest                                        | Playwright                        | Screenshot                |
| -------------------------------------------------------------------------------------------------------- | --- | ------- | ----- | ----------------------------------------------- | --------------------------------- | ------------------------- |
| `recurring-nl`: repeats typed in quick add or the title, including weekday lists and yearly dates        | ✓   | Planned | S3→S5 | covered by `add-recurrence`                     | covered by `add-recurrence`       | —                         |
| `recurring-picker`: presets, custom interval, weekday toggles that keep the popover open, `Don't repeat` | ✓   | Planned | S6    | `RecurringParityTests.test_recurring_picker`    | `recurring › recurring-picker`    | `recurring-picker.png`    |
| `recurring-display`: repeat icon named after the repeat                                                  | ✓   | Planned | S5    | `RecurringParityTests.test_recurring_display`   | `recurring › recurring-display`   | `recurring-display.png`   |
| `recurring-complete`: see `complete-recurring`                                                           | ✓   | Planned | S5    | see Complete                                    | see Complete                      | —                         |
| `recurring-reminders`: reminders and the due time notify at the next occurrence                          | ✓   | Planned | S8    | `RemindersParityTests.test_recurring_reminders` | `reminders › recurring-reminders` | `recurring-reminders.png` |

### Reminders

| Feature                                                                                                 | Web | iOS     | Slice | XCUITest                                       | Playwright                       | Screenshot               |
| ------------------------------------------------------------------------------------------------------- | --- | ------- | ----- | ---------------------------------------------- | -------------------------------- | ------------------------ |
| `reminders-nl`: `remind me 30m before`, `r5m`, `remind me at 4pm`, …                                    | ✓   | Planned | S3→S5 | `QuickAddParityTests.test_reminders_nl`        | `quick-add › reminders-nl`       | `reminders-nl.png`       |
| `reminders-picker`: presets, custom date and time, remove                                               | ✓   | Planned | S6    | `DetailsParityTests.test_reminders_picker`     | `details › reminders-picker`     | `reminders-picker.png`   |
| `reminders-fire`: `Reminder: <title>` toast with `Open` while the app is open                           | ✓   | Planned | S8    | `RemindersParityTests.test_reminders_fire`     | `reminders › reminders-fire`     | `reminders-fire.png`     |
| `reminders-due-time`: the due time notifies alone, a date alone never does, one notification per moment | ✓   | Planned | S2→S8 | `RemindersParityTests.test_reminders_due_time` | `reminders › reminders-due-time` | `reminders-due-time.png` |
| `reminders-notify`: system notifications while closed (Web Push on web, local notifications on iOS)     | ✓   | Planned | S8    | see Notifications                              | see Notifications                | —                        |

### Notifications

The web's Web Push rows map to native local notifications. XCUITests check the pending requests through a DEBUG-only accessibility readout on the Notifications screen, since XCUITest cannot read `UNUserNotificationCenter` directly. The web side keeps its existing push tests, so these rows pair against the web's notifications panel.

| Feature                                                                                                             | Web | iOS     | Slice | XCUITest                                        | Playwright                        | Screenshot            |
| ------------------------------------------------------------------------------------------------------------------- | --- | ------- | ----- | ----------------------------------------------- | --------------------------------- | --------------------- |
| `push-sheet`: Notifications screen in Browse showing `On`, `Off`, or `Blocked`                                      | ✓   | Planned | S8    | `NotificationsParityTests.test_push_sheet`      | `notifications › push-sheet`      | `push-sheet.png`      |
| `push-permission`: asks only from `Turn on notifications`; a denial links to Settings                               | ✓   | Planned | S8    | `NotificationsParityTests.test_push_permission` | `notifications › push-permission` | `push-permission.png` |
| `push-install`: Add to Home Screen guidance (_web only_)                                                            | ✓   | n/a     | —     | —                                               | —                                 | —                     |
| `push-schedule`: the device schedule equals future due times and reminders of open tasks, at most 60 pending on iOS | ✓   | Planned | S8    | `NotificationsParityTests.test_push_schedule`   | `notifications › push-schedule`   | `push-schedule.png`   |
| `push-deliver`: one notification per moment, titled with the task, body such as `Due now`                           | ✓   | Planned | S8    | `NotificationsParityTests.test_push_deliver`    | `notifications › push-deliver`    | `push-deliver.png`    |
| `push-test`: `Send a test notification` and `Turn off`                                                              | ✓   | Planned | S8    | `NotificationsParityTests.test_push_test`       | `notifications › push-test`       | `push-test.png`       |
| `push-nudge`: one `Get notified when it's due?` toast per session                                                   | ✓   | Planned | S8    | `NotificationsParityTests.test_push_nudge`      | `notifications › push-nudge`      | `push-nudge.png`      |
| `push-open`: tapping a notification opens its task                                                                  | ✓   | Planned | S8    | `NotificationsParityTests.test_push_open`       | `notifications › push-open`       | `push-open.png`       |

### Task views

| Feature                                                                    | Web | iOS     | Slice | XCUITest                               | Playwright               | Screenshot           |
| -------------------------------------------------------------------------- | --- | ------- | ----- | -------------------------------------- | ------------------------ | -------------------- |
| `shell-launch`: the app opens on an empty Inbox (pipeline smoke pair)      | ✓   | Built   | S1    | `ShellParityTests.test_shell_launch`   | `shell › shell-launch`   | `shell-launch.png`   |
| `views-inbox`: top-level tasks without a project                           | ✓   | Planned | S5    | `ViewsParityTests.test_views_inbox`    | `views › views-inbox`    | `views-inbox.png`    |
| `views-today`: due today, overdue in its own section                       | ✓   | Planned | S5    | `ViewsParityTests.test_views_today`    | `views › views-today`    | `views-today.png`    |
| `views-upcoming`: grouped by day                                           | ✓   | Planned | S5    | `ViewsParityTests.test_views_upcoming` | `views › views-upcoming` | `views-upcoming.png` |
| `views-empty`: `Inbox zero`, `All clear for today`, `Nothing scheduled`    | ✓   | Planned | S5    | `ViewsParityTests.test_views_empty`    | `views › views-empty`    | `views-empty.png`    |
| `views-counts`: open counts (sidebar on web, tab badges and Browse on iOS) | ✓   | Planned | S5    | `ViewsParityTests.test_views_counts`   | `views › views-counts`   | `views-counts.png`   |

### Projects

| Feature                                                                   | Web | iOS     | Slice | XCUITest                                         | Playwright                          | Screenshot                  |
| ------------------------------------------------------------------------- | --- | ------- | ----- | ------------------------------------------------ | ----------------------------------- | --------------------------- |
| `projects-create`: `Add project` in Browse                                | ✓   | Planned | S7    | `ProjectsParityTests.test_projects_create`       | `projects › projects-create`        | `projects-create.png`       |
| `projects-open`: a project lists its tasks                                | ✓   | Planned | S7    | `ProjectsParityTests.test_projects_open`         | `projects › projects-open`          | `projects-open.png`         |
| `projects-assign`: `#Name` in quick add                                   | ✓   | Planned | S3→S5 | `QuickAddParityTests.test_projects_assign`       | `quick-add › projects-assign`       | `projects-assign.png`       |
| `projects-autocomplete`: `#` suggestions with order, create row, and keys | ✓   | Planned | S5    | `QuickAddParityTests.test_projects_autocomplete` | `quick-add › projects-autocomplete` | `projects-autocomplete.png` |
| `projects-move`: project menu in task details                             | ✓   | Planned | S6    | `DetailsParityTests.test_projects_move`          | `details › projects-move`           | `projects-move.png`         |
| `projects-rename`: from the project's toolbar menu                        | ✓   | Planned | S7    | `ProjectsParityTests.test_projects_rename`       | `projects › projects-rename`        | `projects-rename.png`       |
| `projects-delete`: confirms with the task count and deletes the tasks     | ✓   | Planned | S7    | `ProjectsParityTests.test_projects_delete`       | `projects › projects-delete`        | `projects-delete.png`       |

### Labels

| Feature                                                           | Web | iOS     | Slice | XCUITest                                       | Playwright                        | Screenshot                |
| ----------------------------------------------------------------- | --- | ------- | ----- | ---------------------------------------------- | --------------------------------- | ------------------------- |
| `labels-type`: `@name` adds labels, emails and handles stay text  | ✓   | Planned | S3→S5 | `QuickAddParityTests.test_labels_type`         | `quick-add › labels-type`         | `labels-type.png`         |
| `labels-autocomplete`: `@` suggestions and create row             | ✓   | Planned | S5    | `QuickAddParityTests.test_labels_autocomplete` | `quick-add › labels-autocomplete` | `labels-autocomplete.png` |
| `labels-keep-text`: `Keep as text` on a label chip                | ✓   | Planned | S5    | `QuickAddParityTests.test_labels_keep_text`    | `quick-add › labels-keep-text`    | `labels-keep-text.png`    |
| `labels-chips`: chips on rows                                     | ✓   | Planned | S5    | `ViewsParityTests.test_labels_chips`           | `views › labels-chips`            | `labels-chips.png`        |
| `labels-picker`: toggle and create in a popover that stays open   | ✓   | Planned | S6    | `DetailsParityTests.test_labels_picker`        | `details › labels-picker`         | `labels-picker.png`       |
| `labels-view`: every open task with the label, naming its project | ✓   | Planned | S7    | `LabelsParityTests.test_labels_view`           | `labels › labels-view`            | `labels-view.png`         |
| `labels-rename`: unique ignoring case                             | ✓   | Planned | S7    | `LabelsParityTests.test_labels_rename`         | `labels › labels-rename`          | `labels-rename.png`       |
| `labels-delete`: keeps the tasks                                  | ✓   | Planned | S7    | `LabelsParityTests.test_labels_delete`         | `labels › labels-delete`          | `labels-delete.png`       |
| `labels-search`: label results open the label view                | ✓   | Planned | S7    | `SearchParityTests.test_labels_search`         | `search › labels-search`          | `labels-search.png`       |

### Search

| Feature                                                                      | Web | iOS     | Slice | XCUITest                                    | Playwright                    | Screenshot               |
| ---------------------------------------------------------------------------- | --- | ------- | ----- | ------------------------------------------- | ----------------------------- | ------------------------ |
| `search-open`: the search tab (and `/` or Cmd-K on a hardware keyboard)      | ✓   | Planned | S7    | `SearchParityTests.test_search_open`        | `search › search-open`        | `search-open.png`        |
| `search-match`: titles, notes, projects, labels; every word; accents ignored | ✓   | Planned | S4→S7 | `SearchParityTests.test_search_match`       | `search › search-match`       | `search-match.png`       |
| `search-rank`: field weights and word-start bonus                            | ✓   | Planned | S4→S7 | covered by `search-match`                   | covered by `search-match`     | —                        |
| `search-highlight`: matched spans in titles, excerpts, names, chips          | ✓   | Planned | S7    | `SearchParityTests.test_search_highlight`   | `search › search-highlight`   | `search-highlight.png`   |
| `search-keyboard`: Up, Down, Enter, Escape (iPad hardware keyboard on iOS)   | ✓   | Planned | S7    | `SearchParityTests.test_search_keyboard`    | `search › search-keyboard`    | `search-keyboard.png`    |
| `search-open-result`: task opens details, project or label navigates         | ✓   | Planned | S7    | `SearchParityTests.test_search_open_result` | `search › search-open-result` | `search-open-result.png` |
| `search-completed`: `Completed` group and `Reopen`                           | ✓   | Planned | S7    | `SearchParityTests.test_search_completed`   | `search › search-completed`   | `search-completed.png`   |
| `search-empty`: `No results for "<query>"`                                   | ✓   | Planned | S7    | `SearchParityTests.test_search_empty`       | `search › search-empty`       | `search-empty.png`       |

### Settings and theme

| Feature                                                                                 | Web | iOS     | Slice | XCUITest                                     | Playwright                     | Screenshot                                        |
| --------------------------------------------------------------------------------------- | --- | ------- | ----- | -------------------------------------------- | ------------------------------ | ------------------------------------------------- |
| `settings-popover`: the desktop sidebar's settings popover (_web only_)                 | ✓   | n/a     | —     | —                                            | —                              | —                                                 |
| `settings-sheet`: Settings in Browse (the phone web's settings sheet)                   | ✓   | Planned | S8    | `SettingsParityTests.test_settings_sheet`    | `settings › settings-sheet`    | `settings-sheet.png`                              |
| `settings-theme`: the `Theme` segmented control                                         | ✓   | Planned | S8    | `SettingsParityTests.test_settings_theme`    | `settings › settings-theme`    | `settings-theme.png`                              |
| `settings-import`: `Import from Todoist`                                                | ✓   | Planned | S8    | see Todoist import                           | see Todoist import             | —                                                 |
| `theme-system`: follows the device appearance live                                      | ✓   | Planned | S8    | `ThemeParityTests.test_theme_system`         | `theme › theme-system`         | `theme-system-light.png`, `theme-system-dark.png` |
| `theme-override`: `Light` and `Dark`                                                    | ✓   | Planned | S8    | `ThemeParityTests.test_theme_override`       | `theme › theme-override`       | `theme-override.png`                              |
| `theme-persist`: kept across relaunch, outside task data                                | ✓   | Planned | S8    | `ThemeParityTests.test_theme_persist`        | `theme › theme-persist`        | `theme-persist.png`                               |
| `theme-first-paint`: no flash of the other theme at launch                              | ✓   | Planned | S8    | `ThemeParityTests.test_theme_first_paint`    | `theme › theme-first-paint`    | —                                                 |
| `theme-contrast`: tokens generated from `index.css`, which the web contrast test checks | ✓   | Built   | S1    | n/a (`Tokens.swift` freshness check in CI)   | n/a                            | —                                                 |
| `theme-glass-fallback`: solid glass under Increase Contrast or Reduce Transparency      | ✓   | Planned | S8    | `ThemeParityTests.test_theme_glass_fallback` | `theme › theme-glass-fallback` | `theme-glass-fallback.png`                        |
| `theme-reduced-motion`: instant motion under Reduce Motion                              | ✓   | Planned | S8    | `ThemeParityTests.test_theme_reduced_motion` | `theme › theme-reduced-motion` | —                                                 |

### Todoist import

| Feature                                                                            | Web | iOS     | Slice | XCUITest                                | Playwright                | Screenshot           |
| ---------------------------------------------------------------------------------- | --- | ------- | ----- | --------------------------------------- | ------------------------- | -------------------- |
| `import-pick`: file picker limited to `.zip` (plus "Open in Procrastimate" on iOS) | ✓   | Planned | S8    | `ImportParityTests.test_import_pick`    | `import › import-pick`    | `import-pick.png`    |
| `import-read`: projects, Inbox, labels, nesting, notes, reminders                  | ✓   | Planned | S4→S8 | `ImportParityTests.test_import_read`    | `import › import-read`    | `import-read.png`    |
| `import-dates`: Todoist dates through the parser, unreadable ones in notes         | ✓   | Planned | S4→S8 | covered by `import-read`                | covered by `import-read`  | —                    |
| `import-summary`: counts and warnings                                              | ✓   | Planned | S8    | `ImportParityTests.test_import_summary` | `import › import-summary` | `import-summary.png` |
| `import-dedupe`: a second import adds nothing                                      | ✓   | Planned | S8    | `ImportParityTests.test_import_dedupe`  | `import › import-dedupe`  | `import-dedupe.png`  |
| `import-error`: a non-backup file changes nothing                                  | ✓   | Planned | S8    | `ImportParityTests.test_import_error`   | `import › import-error`   | `import-error.png`   |

### Offline and sync

| Feature                                                                                                                                                                        | Web     | iOS     | Slice  | XCUITest                                                       | Playwright                           | Screenshot      |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------- | ------- | ------ | -------------------------------------------------------------- | ------------------------------------ | --------------- |
| `sync-offline`: everything works with no network                                                                                                                               | ✓       | Planned | S5     | true by construction: unpaired, the app makes no network calls | —                                    | —               |
| `sync-pair`: set up, pair with a code, and remove a device in Settings                                                                                                         | Planned | Planned | Y4, S9 | `SyncParityTests.test_sync_pair`                               | `sync › sync-pair`                   | `sync-pair.png` |
| `sync-propagate`, `sync-reconnect`, `sync-conflict`: changes reach the other client, offline changes upload, concurrent edits converge per [Sync](decisions/sync.md#conflicts) | Planned | Planned | Y4, S9 | `Core` sync tests against vectors                              | `sync.e2e.ts` (two browser contexts) | —               |

## Thread split

One PR per slice, each off `master`, never stacked. A slice starts once the slices it depends on have merged.

| Slice | Thread                                 | Depends on                  | Runs in parallel with |
| ----- | -------------------------------------- | --------------------------- | --------------------- |
| S1    | Scaffold and macOS CI                  | —                           | —                     |
| S2    | Core model, store rules, and vectors   | S1                          | —                     |
| S3    | Parser port                            | S2                          | S4                    |
| S4    | Search and import logic port           | S2                          | S3, S5                |
| S5    | Lists and quick add                    | S3                          | S4                    |
| S6    | Task details, subtasks, recurrence     | S5                          | S7, S8                |
| S7    | Projects, labels, and search UI        | S4, S5                      | S6, S8                |
| S8    | Settings, theme, import, notifications | S4, S5 (S6 for `push-open`) | S6, S7                |
| S9    | iOS sync client                        | S8, Y3, Y4                  | Y5, Y6                |

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
- **S3: Parser port.** The quick add parser and name search (`#` and `@` suggestion order) in `Core`, with `recorded` wrappers in `quick-add.test.ts` and `name-search.test.ts` and their vector files. This is the largest logic port, at about 650 lines of TS tests.
- **S4: Search and import logic port.** `search`, `excerpt`, the CSV reader, and the Todoist reader and merge in `Core`, with vectors from `search.test.ts`, `csv.test.ts`, and `todoist.test.ts`, including the synthetic backup. The zip reader goes in `App` under S8, because it needs Apple's `Compression` framework.
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
