/** `bun scripts/worktree-gc.ts [--dry-run]` runs `agent-t3-worktree gc` on this repository. */
import { dirname, resolve } from 'node:path';
import { run } from './lib';
import { agentCommand } from './agent-command';

const main = dirname(
	resolve(run(['git', '-C', import.meta.dir, 'rev-parse', '--path-format=absolute', '--git-common-dir'])),
);
process.exit(agentCommand('agent-t3-worktree', ['gc', '--repo', main, ...process.argv.slice(2)]));
