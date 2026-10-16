/** Preloaded by `bun test`, so a plain `bun test` or `bun run vectors` never runs against missing or stale output. */
const { exitCode } = Bun.spawnSync(['bun', `${import.meta.dir}/index.ts`], { stdout: 'inherit', stderr: 'inherit' });
if (exitCode !== 0) process.exit(exitCode);
