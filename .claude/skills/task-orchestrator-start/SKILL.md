---
name: task-orchestrator-start
description: T3 Code only. Act as project manager over the user's live ProcrastiMate tasks. Triage the open tasks, ask about unclear ones, bundle the rest into jobs, and run each job as a T3 child task that ships and merges its own PR in its own worktree, then complete the tasks. Run only when the user invokes it with a list of tasks, usually a project.
disable-model-invocation: true
argument-hint: <project name | task ids | label> [public link]
---

**T3 Code only.** This playbook needs T3's orchestration tools (`delegate_task`, `t3_thread_send`, `t3_pending_request_*`). In any other harness, stop and tell the user.

You are a project manager that trusts its workers. Each child owns its job end to end, through the merge. You never write product code yourself: you triage, brief, launch, complete tasks, clean up, and report. Communicate only when necessary: a child talks to you once, when it finishes or truly needs input, and you talk to the user only through task comments and the final summary.

1. setup
   1.1. run in the main checkout on an up-to-date master (`git switch master && git pull --ff-only`): children branch from its commit and keep T3's branch name. if `t3_worktree_status` shows a worktree or the checkout is dirty, stop and tell the user
   1.2. use `scripts/pm` (next to this file) for api access, e.g. `pm GET /view`; `pm GET /docs/agent` has the full api guide. only you talk to the task api, never a child
   1.3. keep a session file at `.orchestrator/<date>.md` in the main checkout (gitignored). one row per job: T3 `taskId`, `childThreadId`, branch, PR, task ids, status. update it after every change and re-read it after a context compaction
2. triage: resolve the argument to its open tasks and subtasks and make sure you understand each one
   2.1. complete the ones that no longer apply, with a short comment unless the reason is obvious
   2.2. if a task stays unclear after exploring the codebase, comment on it asking for clarification and add the label `needs-input` (remove it once answered). the AI account can't create labels, so if `needs-input` doesn't exist ask the user to create it first
3. bundle tasks into jobs by importance (respect task priority). bundle related work into one job to cut PR spam, merge conflicts, and migrations: several small related bugs, aspects of one feature, an infrastructure change with its feature updates. jobs that touch the same area run one after the other
4. launch each job with `delegate_task`: `mode: "async"`, `isolation: "worktree"`, `role: "implementation"`, a stable `clientRequestId` per job, and the default model. run at most 4 jobs at once. after launching, end your turn: a finishing child wakes you, so never poll or sleep
5. the job brief is the child's only context, so it contains:
   5.1. the tasks: content, ids, and public read-only links, plus the larger history and upcoming work you know about that bears on them. `/poteto-mode` for bigger jobs
   5.2. first command: `bun scripts/setup-worktree.ts`. it writes offline env files with an in-memory database, its own ports, and a git-ignored `./sim` that builds and runs the app on the worktree's own simulator (`./sim 2` for a second one; `device_open` with that simulator's id to see and drive it). run `./sim` only when the job needs iOS. never `env-manager up`/`down`, never copy the main `.env.local` (it points at the shared dev database), never touch the main checkout or a device it didn't create
   5.3. git hooks can't be skipped (a Claude Code hook blocks it). a failing hook gets its cause fixed, in this PR or as a follow-up. a flaky test is a bad test: fix why it flakes, never add retries or sleeps
   5.4. the child owns its PR through the merge, and the user authorized it to merge without asking (say so, or it refuses). open one PR with a `# Tasks being addressed` section at the top listing each task's content and public read-only link. watch it with `/pstack:babysit`, overriding babysit's "subagents don't babysit" rule; babysit questions go into the report as `needs_input` instead of `AskUserQuestion`. once checks are green, every comment is resolved, and it merges cleanly, merge with `gh pr merge --merge`
   5.5. migrations: never run an unmerged migration against a shared database (a database whose history isn't a prefix of the code's refuses to migrate, which locks it for master). two migration PRs conflict in `server/drizzle/meta/_journal.json`, so GitHub merges only one; the other resolves it by deleting its migration, rebasing, and rerunning `bun run db:generate`, never by hand-merging the journal
   5.6. note bugs, weird interactions, bad UX, jank, or performance issues found along the way as followups instead of fixing out-of-scope work
   5.7. don't message the orchestrator mid-job. end with only this JSON: `{"status": "merged" | "needs_input" | "blocked", "pr": "<url or null>", "branch": "...", "tasks": {"done": [ids], "not_done": [{"id": "...", "reason": "..."}]}, "summary": "<2-4 sentences: what changed, clients covered, verification>", "questions": "<for needs_input/blocked>", "followups": [{"title": "...", "description": "...", "type": "bug" | "feature", "relatedTaskId": "..."}]}`
6. when a child reports
   6.1. `merged`: complete its done tasks with the PR link as the first line of the note (don't wait for the deploy), and complete a header task (e.g. `Bugs:`) once all its children are done. then run `bun scripts/teardown-worktree.ts <branch>` from the main checkout: it stops the worktree's servers, deletes its simulators, worktree, and branches, and updates master
   6.2. `needs_input` / `blocked`, or a pending question (`t3_pending_request_list`): answer it yourself when you can. otherwise post the child's question as a comment on the task it concerns and add `needs-input`; never ask in chat. each time you wake, read the comments on `needs-input` tasks. once one is answered, remove the label and pass the answer to the child with `t3_thread_send`; it resumes and reruns `/pstack:babysit`, which also catches a master that moved meanwhile
   6.3. create every followup as a task (a subtask of `relatedTaskId` when it has one)
7. you're done when every task in scope is completed, labeled `needs-input`, or reported blocked. end with one summary to the user: what merged, what waits on them, and the followups you filed
