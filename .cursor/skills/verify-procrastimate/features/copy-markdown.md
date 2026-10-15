# Copy as Markdown

A view, a section, or a task copies to the clipboard as a Markdown checklist, ready to paste into notes, a chat, or an LLM. Subtasks nest under their parent, and a toast reads `Copied as Markdown`.

## Sub-features

- `copy-markdown-view` copies a whole view under `# Title`.
- `copy-markdown-section` copies one section under `## Heading`.
- `copy-markdown-task` copies one task with its notes and subtasks.

## How to get to it (user POV)

- Web: the copy button in each view header, labelled `Copy <view> as Markdown`, in Inbox, No date, projects, labels, places, and events.
- Web: the copy button beside each section heading, labelled `Copy <heading> as Markdown`. It shows on hover or focus with a mouse and always on touch.
- Web: the copy button in the task details header.
- iOS: `Copy as Markdown` in a task row's context menu and in task details.
- iOS: `Copy as Markdown` in a section heading's context menu in Inbox and No date.
- iOS: `Copy as Markdown` in the project and label `…` menus, on the place and event screens, and in a Browse project row's context menu.

## Driving it with control-ui and the simulator

Preconditions:

- The baseline state. In quick add, save `Pay rent today #Work p1`, add the subtask `Find checkbook` to it, and save `Call mom tomorrow`.
- The browser grants clipboard read and write.

- **Task.** Open `Pay rent` and choose `Copy task as Markdown`. The button turns into a check, the toast reads `Copied as Markdown`, and the clipboard holds `- [ ] Pay rent · Today · p1 · #Work` with `  - [ ] Find checkbook` under it.
- **Section.** In Inbox, hover `Today` and choose `Copy Today as Markdown`. The clipboard starts with `## Today`, then a blank line, then the same two lines.
- **View.** In Inbox, choose `Copy Inbox as Markdown`. The clipboard holds `# Inbox`, the `## Today` section, and `## Tomorrow` with `- [ ] Call mom · Tomorrow`.
- **Project.** In `Work`, choose `Copy Work as Markdown`. The clipboard starts with `# Work`, and its rows leave out `#Work`.
- **iOS.** Long-press `Pay rent` and choose `Copy as Markdown`. `xcrun simctl pbpaste booted` prints the same text as the web task copy.

## Gotchas

- The text comes from `toMarkdown` in `shared/markdown.ts`, and its vectors pin the exact output. Check the clipboard text, not only the toast.
- A subtask whose parent is also copied shows only under the parent, so an Inbox copy can hold fewer top-level rows than the screen.
- Headless browsers reject `navigator.clipboard.writeText` without the clipboard permission. That shows `Couldn’t copy`, not a bug.
