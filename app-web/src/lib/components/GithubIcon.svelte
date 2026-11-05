<script lang="ts">
	import GithubLogo from 'phosphor-svelte/lib/GithubLogo';
	import GitPullRequest from 'phosphor-svelte/lib/GitPullRequest';
	import GitMerge from 'phosphor-svelte/lib/GitMerge';
	import RadioButton from 'phosphor-svelte/lib/RadioButton';
	import CheckCircle from 'phosphor-svelte/lib/CheckCircle';
	import type { GithubKind, GithubState } from 'shared/github.ts';

	let { kind, state, size }: { kind: GithubKind; state: GithubState | null | undefined; size: number } = $props();

	const TONES: Record<GithubState, string> = {
		open: 'var(--tone-soon)',
		draft: 'var(--color-muted)',
		merged: 'var(--tone-week)',
		closed: 'var(--tone-overdue)',
	};
	// GitHub draws a closed issue as done, in the merged purple, and a closed pull request in red.
	const tone = $derived(!state ? 'currentColor' : kind === 'issue' && state === 'closed' ? TONES.merged : TONES[state]);
	const Icon = $derived(
		!state ? GithubLogo : kind === 'pull' ? (state === 'merged' ? GitMerge : GitPullRequest) : state === 'closed' ? CheckCircle : RadioButton,
	);
</script>

<Icon {size} color={tone} weight={state ? 'bold' : 'regular'} class="shrink-0" />
