/** `bun scripts/teardown-worktree.ts <worktree path | branch | dir> [--force]` runs `agent-t3-worktree teardown`. */
import { agentCommand } from './agent-command';

process.exit(agentCommand('agent-t3-worktree', ['teardown', ...process.argv.slice(2)]));
