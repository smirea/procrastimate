/**
 * `bun scripts/setup-worktree.ts [--reset-db]` runs `agent-t3-worktree setup`, which T3 already runs on every new
 * worktree. `--reset-db` deletes `.data/`. The repo's own steps are the `worktree:setup` package script.
 */
import { agentCommand } from './agent-command';

const args = process.argv.slice(2).map(arg => (arg === '--reset-db' ? '--reset-data' : arg));
process.exit(agentCommand('agent-t3-worktree', ['setup', ...args]));
