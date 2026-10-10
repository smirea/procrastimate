# Labels UI

- **Rows.** A row shows its labels as small tinted chips after its date, repeat, and reminders, wrapping onto a second line when space runs out.
- **Sidebar.** A Labels section below Projects lists every label alphabetically with its open task count. It appears once a label exists, because labels are created inline, so an empty section would only add clutter.
- **Details picker.** A `Labels` chip on its own row under the title opens a menu with a filter field and the labels in autocomplete order, each with a check. A tap toggles a label and keeps the menu open, unlike single-value pickers, since a task often takes several labels. Enter toggles the highlighted row or creates the typed label. The field takes focus on desktop only, so a phone keeps its keyboard down until the field is tapped. The row sits outside the details body because the body scrolls while the keyboard is up, and a scroll container clips popovers.
- **Quick add.** No label picker, since `@` covers it and one more chip wraps the chip row on a phone. Typed labels and a label view's default label show as chips.
- **Label actions.** A label view's header renames or deletes the label. Delete confirms and keeps the tasks. Label names are unique ignoring case, because `@name` must resolve to one label, so a rename onto another label's name is ignored.
- **Punctuation ends a fragment.** A `#` or `@` fragment ending in `,`, `.`, `;`, `:`, `!`, `?`, or `)` closes its list, matching the parser, so `Call @calls,` plus Enter saves instead of offering to create `calls,`.
- **Search.** Search matches label names and lists labels as their own group. See Search.
