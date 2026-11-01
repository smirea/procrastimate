/**
 * Runs one of the shared agent commands (`~/bin/agent-t3-worktree`, `~/bin/agent-simulator`) from `~/code/scripts`,
 * which own the worktree and simulator lifecycle. No npm imports: setup runs before `bun install`.
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

type Command = 'agent-t3-worktree' | 'agent-simulator';

function resolveCommand(name: Command): string {
	const path = join(process.env.HOME ?? '', 'bin', name);
	if (!existsSync(path)) throw new Error(`${path} is missing. Install it: bun ~/code/scripts/src/setup.ts`);
	return path;
}

/** Runs it with the terminal attached and answers its exit status. */
export function agentCommand(name: Command, args: string[]): number {
	return spawnSync(resolveCommand(name), args, { stdio: 'inherit' }).status ?? 1;
}

/** Runs it with stdout captured, exiting with its status on a failure. */
export function agentOutput(name: Command, args: string[]): string {
	const result = spawnSync(resolveCommand(name), args, { stdio: ['inherit', 'pipe', 'inherit'], encoding: 'utf8' });
	if (result.status !== 0) process.exit(result.status ?? 1);
	return result.stdout.trim();
}
