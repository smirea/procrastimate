<script lang="ts">
	import { session } from '../session.svelte.ts';

	let email = $state('');
	let password = $state('');
	let creating = $state(false);
	let busy = $state(false);
	let opening = $state<'google' | 'apple' | null>(null);

	const submitLabel = $derived(
		busy ? (creating ? 'Creating account…' : 'Signing in…') : creating ? 'Create account' : 'Sign in',
	);

	/** The provider's page loads next, so the button says so until the redirect, or until it fails. */
	async function social(provider: 'google' | 'apple') {
		opening = provider;
		await session.social(provider);
		if (session.error) opening = null;
	}

	/** Back from the provider can restore this page from the back-forward cache with the button still waiting. */
	function onpageshow(event: PageTransitionEvent) {
		if (event.persisted) opening = null;
	}

	async function onsubmit(event: SubmitEvent) {
		event.preventDefault();
		if (busy) return;
		busy = true;
		if (creating) await session.signUp(email, password);
		else await session.signIn(email, password);
		busy = false;
	}
</script>

<svelte:window {onpageshow} />

<div class="flex min-h-dvh flex-col items-center justify-center gap-5 px-4">
	<img src="/icons/logo.png" alt="" width="160" height="160" class="-mb-3 size-40" />
	<form class="glass-strong flex w-full max-w-sm flex-col gap-3 rounded-3xl p-6" aria-label="Sign in" {onsubmit}>
		<h1 class="text-[22px] font-semibold tracking-tight text-ink">ProcrastiMate</h1>

		{#if session.methods.email}
			<label class="flex flex-col gap-1 text-[13px] text-muted">
				Email
				<input
					type="email"
					name="email"
					autocomplete="email"
					required
					bind:value={email}
					class="h-11 rounded-2xl bg-ink/5 px-3 text-[15px] text-ink outline-none"
				/>
			</label>
			<label class="flex flex-col gap-1 text-[13px] text-muted">
				Password
				<input
					type="password"
					name="password"
					autocomplete={creating ? 'new-password' : 'current-password'}
					required
					minlength="8"
					bind:value={password}
					class="h-11 rounded-2xl bg-ink/5 px-3 text-[15px] text-ink outline-none"
				/>
			</label>
			<button type="submit" class="btn press bg-accent text-on-accent" disabled={busy}>{submitLabel}</button>
			<button type="button" class="text-[13px] text-muted" onclick={() => (creating = !creating)}>
				{creating ? 'Already have an account' : 'Create an account'}
			</button>
		{/if}

		{#if session.methods.google}
			<button type="button" class="btn press" disabled={opening !== null} onclick={() => social('google')}>
				{opening === 'google' ? 'Opening Google…' : 'Sign in with Google'}
			</button>
		{/if}
		{#if session.methods.apple}
			<button type="button" class="btn press" disabled={opening !== null} onclick={() => social('apple')}>
				{opening === 'apple' ? 'Opening Apple…' : 'Sign in with Apple'}
			</button>
		{/if}

		{#if session.error}
			<p role="alert" class="text-[13px] text-[var(--tone-overdue)]">{session.error}</p>
		{/if}
	</form>
</div>
