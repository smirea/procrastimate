---
name: task-orchestrator-start
description: Act as project manager over Stefan's live ProcrastiMate tasks. Triage the open tasks, ask about unclear ones, bundle the rest into jobs, give each job to an isolated subagent that ships and merges one PR, then complete the tasks. Run only when Stefan invokes it with a list of tasks, usually a project.
disable-model-invocation: true
argument-hint: <project name | task ids | label> [public link]
---

# Task orchestrator

You are the project manager. Stefan hands you a list of tasks from production. You understand them, bundle them into jobs, and give each job to a subagent that owns it end to end: build, PR, babysit, merge, clean up. You trust the subagents to do the work. Your job is to make each one well-informed and to keep the task list true. You don't build features yourself in this thread, because your context has to last the whole run.

Arguments: $ARGUMENTS

## The API

The tasks live in production. `scripts/pm` (next to this file) calls the agent API as Stefan's AI account, reading `APP_BOT_API_URL` and `APP_BOT_TOKEN` from the main checkout's `.env.local`:

```bash
PM=.claude/skills/task-orchestrator-start/scripts/pm
$PM GET /view                                        # tasks, projects, sections, labels
$PM GET "/comments?id=<task>"
$PM POST /comments -d '{"taskId":"<task>","body":"…"}'
$PM PATCH "/tasks?id=<task>" -d '{"labelIds":[…]}'   # arrays replace, so send the full list
$PM POST "/tasks/complete?id=<task>"
$PM POST /tasks -d '{"title":"…","parentId":"<task>","labelIds":[…]}'
$PM GET "/images?id=<image>&size=full" -o /tmp/<image>.jpg
```

For anything else, read the guide: `$PM GET /docs/agent`. Writes land in Stefan's real data, so read before you change anything. The AI account can't create projects, labels, or share links. Resolve label ids by name from `/view` every run, and never hardcode them.

If `env-manager down` makes its own commit that only bumps a timestamp or reformats a generated reader, drop that commit before anything is pushed.

## 1. Understand the tasks

Resolve the arguments to a set of open tasks. A project name means every open task in it, including subtasks at any depth. Then, for each task:

- Read its title, notes, priority, labels, subtasks, and comments. Download its images and look at them, because bug reports are often screenshots.
- Explore the code it touches until you could explain the change to someone else. Read `docs/decisions/` for the area, and `.cursor/skills/verify-procrastimate/features/` for user-facing behavior. Delegate the wide sweeps to `Explore` agents so your context stays small.

Then sort each task into one of three groups:

- **No longer applicable.** It's already built, superseded, or moot. Complete it. Add a short comment saying why, unless the reason is obvious.
- **Unclear.** You still can't act after exploring, or it allows readings that would ship different things. Comment with the specific question, offering the options you see and the one you'd pick. Add the `needs-input` label.
- **Ready.** It goes into a job.

Tasks that already carry `needs-input`: if a comment from someone other than the AI account came after your question, it's answered. Remove the label and treat the task as ready. Otherwise leave it.

## 2. Bundle into jobs

Rank by importance: priority first (`1` is most urgent), then how much a task blocks others or hurts daily use. Bugs that break sync or lose data come before polish.

Bundle the ready tasks into jobs. One job is one subagent, one thread, one PR. Bundle to cut PR spam and merge conflicts:

- Several small bugs in the same area.
- Several aspects of one feature.
- An infrastructure change together with the features that depend on it.

Keep a job small enough to review in one sitting. Split unrelated work even when it is small.

Plan for conflicts between jobs, because they run in parallel:

- Jobs that touch the same files run one after another.
- Only one job that adds a DB migration may be open at a time. Migrations are numbered, so two in flight collide, and a regenerated migration on top of master has bitten before.
- Generated files (`bun run generate`) conflict often. Tell the second job to regenerate them after rebasing instead of hand-merging them.

Run about 3 or 4 jobs at once. Hold the rest and start them as slots free up, highest importance first.

## 3. Brief and launch

Launch each job with the `Agent` tool and `isolation: "worktree"`. Use `subagent_type: "pstack:poteto-agent"` for features, refactors, and anything spanning several files or clients, and `general-purpose` for a bundle of small, obvious fixes. Use the model that `~/.claude/pstack-models.md` names for the role.

The subagent sees only its brief, so the brief carries everything you know that it doesn't. Include:

- **The tasks, verbatim.** For each: the id, title, notes, priority, subtasks, the relevant comments (including Stefan's answers), and the paths of any images you downloaded.
- **Your read of each task.** What you think is wanted, where the code lives, and anything you ruled out.
- **Context only you have.** Related tasks in this run or still open, jobs running in parallel and the files they own, work likely to come next that this job shouldn't block, and past decisions that matter.
- **The ownership contract.** Copy it verbatim:

> You own these tasks end to end. Follow the repo's AGENTS.md files and `docs/decisions/workflow.md`: build for web and iOS unless the plan says why a client is excluded, run only the relevant tests locally, record new decisions in `docs/decisions/`, and update the feature map. Build it yourself. Never hand the whole build to a helper that can't receive messages.
>
> Branch off `master` in your worktree. A fresh worktree has no ignored env files: run `env-manager down` there and drop any commit it makes on its own.
>
> Open one PR. Its body starts with a `# Tasks being addressed` section that lists each task's title and notes, quoted, with a link to the task. Use `<PUBLIC_LINK>` as the link: the public read-only page for these tasks. Then run `/babysit` on the PR until CI is green and review comments are handled, and merge it with `gh pr merge --merge --delete-branch`. Keep going after merging; you are not waiting for the deploy.
>
> As you work, watch for bugs, odd interactions, bad UX, jank, and slow paths. Fix the ones that belong to this change. Report the rest instead of fixing them.
>
> After the merge, clean up everything you created: shut down simulators you booted, stop dev servers, delete the worktree and your local branch, and trash temp files.
>
> End with a report: the PR URL, the merge state, which task ids are done and which aren't (with the reason), and each follow-up issue as a title, a one-line description, a type (bug or feature), and the task it relates to.

Fill in `<PUBLIC_LINK>` with the public read-only link Stefan gave in the arguments. The AI account can't make share links, so if the arguments have none, ask Stefan for one before launching the first job. Then link each PR to this thread (`link_pull_request`) as soon as you learn its URL.

## 4. While jobs run

You are woken as each job finishes. Between jobs:

- Check the `needs-input` tasks for answers. Put each answered task into a waiting job, or into a running job that it fits, by sending that job the task with `SendMessage`.
- When Stefan says something mid-run that changes a job, pass it on to that job with `SendMessage`.

When a job reports:

1. Confirm that the PR really merged: `gh pr view <n> --json state,mergedAt`. If it didn't, find out why. Resume the job with `SendMessage`, or relaunch it with a brief that names the existing PR.
2. Complete each task the job finished. First, set the PR URL as the first line of the notes, keeping the existing notes below it: `PATCH /tasks?id=…` with `notes`. Then call `POST /tasks/complete`. Completing a parent also completes all of its subtasks, so if the job addressed only some subtasks, complete those individually and leave the parent open.
3. File the follow-ups. Check each one against the open tasks and the other jobs' reports so you don't file duplicates. If it fits a running job, send it there. Otherwise create it in the same project, as a subtask when it extends an existing task, with the `bug` or `feature` label. Put the PR it came from in the notes.
4. Start the next waiting job.

## 5. Finish

When no job is running or waiting, check that `git worktree list` and the local branches hold nothing from this run, and that no simulator this run booted is still up. Then tell Stefan, briefly:

- the PRs merged and the tasks they closed
- the tasks completed as no longer applicable
- the questions still waiting on him under `needs-input`
- the follow-up tasks you filed
- anything that failed or is still open
