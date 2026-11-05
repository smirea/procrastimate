# GitHub on tasks

A task carries GitHub issues and pull requests as metadata. Task details show each one under the date, priority, and reminder chips with its live title, number, and state (open, draft, merged, or closed), and tapping it opens GitHub: a new tab on the web, Safari or the GitHub app on iOS. A task row shows a GitHub mark and each `#number`. The server reads GitHub's API with an optional `GITHUB_TOKEN`, which also titles a pasted GitHub link.

## Sub-features

- `attach` adds an issue or pull request from a pasted github.com link (a page under it such as `/files` counts) or `owner/repo#123`, through the GitHub chip in details. A link already attached is not added twice.
- `live-state` shows the title and state GitHub has now, read through `GET /api/github?url=`, and reads it again once the last answer is a minute old. Without an answer the chip shows `repo#number`.
- `open` opens the issue or pull request on GitHub, in a new tab on the web.
- `remove` takes one off with its `×`.
- `row-number` shows the GitHub mark and `#number` on the task's row.
- `paste-title` titles a pasted GitHub issue or pull request link with its title from GitHub's API, and any other GitHub page with its tab title without ` · GitHub`.

## How to get to it (user POV)

- Web: open a task, click the GitHub chip under the date chips, paste `https://github.com/smirea/procrastimate/pull/309`, and press Enter. The chip reads the PR's title, `#309`, and the merged icon in purple. Clicking it opens GitHub in a new tab.
- iOS: open a task, tap the GitHub chip, paste the link into the alert, and tap `Attach`.

## Driving it

- **Web.** `a pasted pull request link attaches it to the task, shows its live title and state, opens GitHub in a new tab, and comes off again` in `e2e/github.e2e.ts` covers `attach`, `live-state`, `open`, `remove`, and `row-number` with `/api/github` stubbed. `an attached issue GitHub cannot read shows its repo and number` in `e2e/github.e2e.ts` covers the fallback.
- **Server.** `GET /api/github` in `server/src/github.test.ts` covers the API states, the token header, the page-title fallback, and the null answer. Against real GitHub, sign up on the worktree's server and `curl -b <cookies> "localhost:<CLIENT_PORT>/api/github?url=https://github.com/smirea/procrastimate/pull/309"` answers its title, `merged`, and `pull`. A private repo answers nulls without `GITHUB_TOKEN`.
- **iOS.** With the worktree's server running, `./sim test` a throwaway XCUITest that signs in with an email account on that server, launches with `PROCRASTIMATE_DEMO="seed details:Buy+oat+milk"`, taps `Add a GitHub issue or pull request`, types the link into the alert, and taps `Attach`. The chip's label reads `Pull request procrastimate#309, <title>, Merged`, tapping it brings Safari to the foreground, and `Remove procrastimate#309` takes it off. The `No date` row then shows `#309`.
- **Paste titles.** The same as `edit-link-paste` in [Edit task](./edit-task.md), with a GitHub pull request link: the title reads `[<PR title>](<link>)`.
