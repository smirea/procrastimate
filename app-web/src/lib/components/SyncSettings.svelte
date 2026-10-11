<script lang="ts">
	import { fly, slide } from 'svelte/transition';
	import { cubicOut } from 'svelte/easing';
	import { flip } from 'svelte/animate';
	import CloudArrowUp from 'phosphor-svelte/lib/CloudArrowUp';
	import CloudCheck from 'phosphor-svelte/lib/CloudCheck';
	import CloudSlash from 'phosphor-svelte/lib/CloudSlash';
	import CloudWarning from 'phosphor-svelte/lib/CloudWarning';
	import ArrowsClockwise from 'phosphor-svelte/lib/ArrowsClockwise';
	import DeviceMobile from 'phosphor-svelte/lib/DeviceMobile';
	import Key from 'phosphor-svelte/lib/Key';
	import type { DeviceInfo, PairingCode } from 'shared/auth.ts';
	import { PAIRING_CODE_LENGTH } from 'shared/auth.ts';
	import { store } from '../store.svelte.ts';
	import { sync } from '../sync.svelte.ts';
	import { motion } from '../ui.svelte.ts';

	type Entry = 'setup' | 'redeem';

	const PAIRING_POLL = 2000;

	let entry = $state<Entry | null>(null);
	let code = $state('');
	let busy = $state(false);
	let error = $state<string | null>(null);
	let pairing = $state<PairingCode | null>(null);
	let devices = $state<DeviceInfo[] | null>(null);

	const reveal = () => motion({ duration: 200, easing: cubicOut });
	const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
	const waiting = $derived(store.pending ? ` · ${plural(store.pending, 'change')} waiting` : '');

	const relative = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
	function seen(at: number) {
		const minutes = Math.round((at - Date.now()) / 60_000);
		if (Math.abs(minutes) < 1) return 'Synced just now';
		if (Math.abs(minutes) < 60) return `Synced ${relative.format(minutes, 'minute')}`;
		const hours = Math.round(minutes / 60);
		if (Math.abs(hours) < 24) return `Synced ${relative.format(hours, 'hour')}`;
		return `Synced ${relative.format(Math.round(hours / 24), 'day')}`;
	}

	/** Shows the code in two groups of four, which is easier to read out and type. */
	const grouped = (value: string) => `${value.slice(0, 4)} ${value.slice(4)}`;

	function open(next: Entry) {
		entry = next;
		code = '';
		error = null;
	}

	async function run(action: () => Promise<void>) {
		busy = true;
		error = null;
		try {
			await action();
		} catch (failure) {
			error = failure instanceof Error ? failure.message : 'Something went wrong.';
		} finally {
			busy = false;
		}
	}

	function submit(event: SubmitEvent) {
		event.preventDefault();
		void run(async () => {
			await (entry === 'setup' ? sync.setUp(code) : sync.redeem(code));
			entry = null;
			code = '';
		});
	}

	/** Refreshes quietly after each sync, so a newly paired device shows up while Settings is open. */
	async function loadDevices() {
		devices = await sync.devices().catch(() => devices);
	}

	const showCode = () =>
		run(async () => {
			pairing = await sync.pairingCode();
		});

	const remove = (device: DeviceInfo) =>
		run(async () => {
			await sync.remove(device);
			devices = devices?.filter(d => d.id !== device.id) ?? null;
		});

	/** While a code is showing, watches for the new device and hides the code once it has joined. */
	$effect(() => {
		if (!pairing) return;
		const known = new Set(devices?.map(d => d.id));
		const timer = setInterval(async () => {
			await loadDevices();
			if (devices?.some(d => !known.has(d.id))) pairing = null;
		}, PAIRING_POLL);
		return () => clearInterval(timer);
	});

	$effect(() => {
		if (!store.paired) {
			devices = null;
			pairing = null;
			return;
		}
		if (sync.status.kind === 'synced') void loadDevices();
	});
</script>

<section class="flex flex-col gap-1.5" aria-labelledby="sync-heading">
	<h3 id="sync-heading" class="heading">Sync</h3>

	{#if store.paired}
		<p role="status" aria-label="Sync status" class="flex items-center gap-2 px-1 text-[13px] text-muted">
			{#if sync.status.kind === 'syncing'}
				<ArrowsClockwise size={16} class="spin text-accent" />
				Syncing{waiting}
			{:else if sync.status.kind === 'offline'}
				<CloudSlash size={16} />
				Offline{waiting}
			{:else if sync.status.kind === 'error'}
				<CloudWarning size={16} class="text-[var(--tone-overdue)]" />
				{sync.status.message}{waiting}
			{:else}
				<CloudCheck size={16} class="text-[var(--tone-today)]" />
				{store.pending ? `${plural(store.pending, 'change')} waiting` : 'Up to date'}
			{/if}
		</p>

		{#if pairing}
			<div
				role="group"
				aria-label="Pairing code"
				class="code flex flex-col items-center gap-1 px-3 py-3 text-center"
				in:fly={motion({ y: 6, duration: 220, easing: cubicOut })}
			>
				<output class="font-mono text-[22px] font-semibold tracking-[0.18em] text-ink">{grouped(pairing.code)}</output>
				<p class="text-[12px] text-muted">Enter this code on the other device within 10 minutes.</p>
				<button type="button" class="btn btn-quiet mt-1 h-8" onclick={() => (pairing = null)}>Done</button>
			</div>
		{:else}
			<button type="button" class="menu-item -mx-1.5 w-auto touch:h-11 touch:text-[15px]" disabled={busy} onclick={showCode}>
				<DeviceMobile size={18} class="text-muted" />
				Pair a device
			</button>
		{/if}

		{#if devices}
			<ul aria-label="Devices" class="flex flex-col gap-1" transition:slide={reveal()}>
				{#each devices as device (device.id)}
					<li class="device flex items-center gap-2 py-1.5 pr-1.5 pl-2.5" animate:flip={motion({ duration: 220 })} out:slide={reveal()}>
						<div class="flex min-w-0 flex-1 flex-col">
							<span class="truncate text-[13px] text-ink">{device.name}</span>
							<span class="text-[11px] text-faint">{device.current ? 'This device' : seen(device.lastSeenAt)}</span>
						</div>
						<button
							type="button"
							class="btn btn-quiet h-7 px-3 text-[12px] touch:h-9"
							aria-label={`Remove ${device.name}${device.current ? ' (this device)' : ''}`}
							disabled={busy}
							onclick={() => remove(device)}
						>
							Remove
						</button>
					</li>
				{/each}
			</ul>
		{/if}
	{:else}
		<p class="text-[12px] text-muted">Keep your tasks the same on every device.</p>
		{#if sync.status.kind === 'off' && sync.status.notice}
			<p role="status" class="text-[12px] text-muted">{sync.status.notice}</p>
		{/if}

		{#if entry}
			<form class="flex flex-col gap-2 pt-0.5" onsubmit={submit} in:slide={reveal()}>
				<input
					class="field w-full {entry === 'redeem' ? 'font-mono tracking-[0.12em] uppercase' : ''}"
					aria-label={entry === 'setup' ? 'Setup code' : 'Pairing code'}
					placeholder={entry === 'setup' ? 'Setup code' : 'ABCD EFGH'}
					type={entry === 'setup' ? 'password' : 'text'}
					autocomplete="off"
					autocapitalize={entry === 'redeem' ? 'characters' : 'off'}
					spellcheck="false"
					maxlength={entry === 'redeem' ? PAIRING_CODE_LENGTH + 2 : undefined}
					bind:value={code}
					{@attach node => node.focus()}
				/>
				<div class="flex justify-end gap-1.5">
					<button type="button" class="btn btn-quiet h-8" onclick={() => (entry = null)}>Cancel</button>
					<button type="submit" class="btn btn-primary h-8" disabled={busy || !code.trim()}>
						{entry === 'setup' ? 'Turn on sync' : 'Pair'}
					</button>
				</div>
			</form>
		{:else}
			<button type="button" class="menu-item -mx-1.5 w-auto touch:h-11 touch:text-[15px]" onclick={() => open('setup')}>
				<CloudArrowUp size={18} class="text-muted" />
				Set up sync
			</button>
			<button type="button" class="menu-item -mx-1.5 w-auto touch:h-11 touch:text-[15px]" onclick={() => open('redeem')}>
				<Key size={18} class="text-muted" />
				Enter a pairing code
			</button>
		{/if}
	{/if}

	{#if error}
		<p role="alert" class="px-1 text-[13px] text-[var(--tone-overdue)]" in:fly={motion({ y: 6, duration: 220, easing: cubicOut })}>{error}</p>
	{/if}
</section>

<style>
	.heading {
		font-size: 0.75rem;
		font-weight: 500;
		letter-spacing: 0.025em;
		text-transform: uppercase;
		color: var(--color-faint);
	}

	.code,
	.device {
		border-radius: 0.875rem;
		background: color-mix(in srgb, var(--color-ink) 5%, transparent);
	}

	:global(.spin) {
		animation: spin 900ms linear infinite;
	}

	@keyframes spin {
		to {
			rotate: 360deg;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		:global(.spin) {
			animation: none;
		}
	}
</style>
