# Domain

- **Task.** A title, optional notes, an optional project, any number of labels, an optional due date with an optional time, an optional recurrence, a priority, a list of reminders, an optional completion time, and an optional parent task with a position among its siblings.
- **Subtask.** A task with a parent task. It is a full task with its own date, repeat, priority, and reminders, and it nests to any depth. See Subtasks.
- **Recurrence.** Repeats every interval of days, weekdays (Monday to Friday), weeks, months, or years, counted from the due date. A weekly repeat can carry a set of weekdays, such as Monday, Wednesday, and Friday, and then repeats on each of them. Without a set it repeats on the due date's weekday. A recurring task is one task whose due date moves forward. It has no separate history of past occurrences.
- **Inbox.** Top-level tasks without a project. Inbox is a view, not a project.
- **Today.** Incomplete tasks due today or earlier, subtasks included. Overdue tasks are marked.
- **Upcoming.** Incomplete tasks due after today, subtasks included, grouped by day.
- **Project.** A named group of tasks. Deleting a project deletes its tasks.
- **Label.** A named tag that crosses projects. A task carries any number of labels, stored as label ids in the order they were added. A label owns no tasks, so deleting a label only takes it off its tasks. Labels with no tasks still exist and still show in the sidebar.
- **Label view.** Every open task carrying a label, across all projects and Inbox, with each row naming its project. Quick add from a label view starts with that label.
- **Priority.** Todoist's four levels. `p1` is the most urgent and `p4` is the default with no marking.
- **Reminder.** Either relative to the due time (for example 30 minutes before) or at an absolute date and time. A relative reminder needs a due time to fire. A due time is itself a reminder. Any task with a due time notifies at that time with no reminder set, and reminders add to it, such as 30 minutes before. A date with no time never notifies. A task notifies once per moment, so a reminder at the due time does not notify twice. A repeating task notifies at each occurrence's due time, because completing it moves the due date. While the app is open a reminder shows an in-app toast. Web Push delivers the system notification, whether the app is open or closed. See Push notifications.
