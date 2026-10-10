<script lang="ts">
	import { onMount, type Component } from 'svelte';
	import { fade, fly, scale } from 'svelte/transition';
	import { cubicOut } from 'svelte/easing';
	import X from 'phosphor-svelte/lib/X';
	import Bell from 'phosphor-svelte/lib/Bell';
	import BellRinging from 'phosphor-svelte/lib/BellRinging';
	import BellSlash from 'phosphor-svelte/lib/BellSlash';
	import DeviceMobile from 'phosphor-svelte/lib/DeviceMobile';
	import Export from 'phosphor-svelte/lib/Export';
	import PlusSquare from 'phosphor-svelte/lib/PlusSquare';
	import WarningCircle from 'phosphor-svelte/lib/WarningCircle';
	import { push, type PushState } from '../push.svelte.ts';
	import { pushSchedule } from '../push-schedule.ts';
	import { store } from '../store.svelte.ts';
	import { clock, mobile, sheets, motion } from '../ui.svelte.ts';

	type Icon = Component<{ size?: number; weight?: 'regular' | 'fill' | 'bold'; class?: string }>;
	type Action = { label: string; run: () => void; primary?: boolean; disabled?: boolean };
	type Step = { icon: Icon; parts: (string | { strong: string })[] };
	type View = { icon: Icon; heading: string; body: string[]; steps?: Step[]; actions: Action[] };

	let test = $state<'idle' | 'sending' | 'sent' | 'failed'>('idle');
	let dialog: HTMLDivElement;

	const scheduled = $derived(push.state.kind === 'on' ? pushSchedule(store.tasks, clock.now).length : 0);
	const close = () => sheets.close();

	async function sendTest() {
		test = 'sending';
		test = (await push.sendTest()) ? 'sent' : 'failed';
		setTimeout(() => (test = 'idle'), 3000);
	}

	const testLabel = { idle: 'Send a test notification', sending: 'Sending…', sent: 'Sent', failed: 'Couldn’t send' };

	function viewOf(state: PushState): View {
		const install: Action[] = push.installPrompt ? [{ label: 'Install app', run: () => void push.promptInstall() }] : [];
		switch (state.kind) {
			case 'checking':
				return { icon: Bell, heading: 'Notifications', body: ['Checking this device…'], actions: [] };
			case 'off':
			case 'enabling':
				return {
					icon: BellRinging,
					heading: 'Get notified when tasks are due',
					body: [
						'Procrastimate notifies you at each due time and reminder, even when the app is closed.',
						'Dates without a time stay quiet. You can turn notifications off any time.',
					],
					actions: [
						...install,
						{ label: 'Not now', run: close },
						{
							label: state.kind === 'enabling' ? 'Turning on…' : 'Turn on notifications',
							run: () => push.enable(),
							primary: true,
							disabled: state.kind === 'enabling',
						},
					],
				};
			case 'install':
				return {
					icon: DeviceMobile,
					heading: 'Add Procrastimate to your Home Screen',
					body: ['iPhone only delivers web notifications to apps on the Home Screen, on iOS 16.4 or later.'],
					steps: [
						{ icon: Export, parts: ['Tap ', { strong: 'Share' }, ' in Safari’s toolbar.'] },
						{ icon: PlusSquare, parts: ['Choose ', { strong: 'Add to Home Screen' }, '.'] },
						{ icon: Bell, parts: ['Open Procrastimate from your Home Screen and turn on notifications here.'] },
					],
					actions: [{ label: 'Got it', run: close }],
				};
			case 'denied':
				return {
					icon: BellSlash,
					heading: 'Notifications are blocked',
					body: [
						'On iPhone, open Settings › Notifications › Procrastimate and turn on Allow Notifications.',
						'In a desktop browser, allow notifications in this site’s settings, behind the icon left of the address. Then check again.',
					],
					actions: [{ label: 'Check again', run: () => void push.detect(), primary: true }],
				};
			case 'on':
				return {
					icon: BellRinging,
					heading: 'Notifications are on',
					body: [scheduled ? `${scheduled} scheduled on this device` : 'Nothing scheduled yet'],
					actions: [
						...install,
						{ label: 'Turn off', run: () => void push.disable() },
						{ label: testLabel[test], run: () => void sendTest(), primary: true, disabled: test === 'sending' },
					],
				};
			case 'unavailable':
				return {
					icon: BellSlash,
					heading: 'Notifications aren’t available on this server',
					body: ['This server can’t send push notifications. Reminders still show while Procrastimate is open.'],
					actions: [],
				};
			case 'unsupported':
				return {
					icon: BellSlash,
					heading: 'Notifications aren’t supported here',
					body: ['This browser can’t notify you while Procrastimate is closed. Reminders still show while it’s open.'],
					actions: [],
				};
			case 'error':
				return {
					icon: WarningCircle,
					heading: 'Couldn’t set up notifications',
					body: [state.message],
					actions: [{ label: 'Try again', run: () => void push.detect(), primary: true }],
				};
			default: {
				const never: never = state;
				return never;
			}
		}
	}

	const view = $derived(viewOf(push.state));

	onMount(() => {
		dialog.focus();
		void push.detect();
	});

	const enter = (node: Element) =>
		mobile.current
			? fly(node, motion({ y: '100%', duration: 300, easing: cubicOut, opacity: 1 }))
			: scale(node, motion({ start: 0.96, duration: 200, easing: cubicOut, opacity: 0 }));
</script>

<div class="fixed inset-0 z-40 bg-scrim backdrop-blur-[2px]" transition:fade={motion({ duration: 160 })} onclick={close} aria-hidden="true"></div>
<div
	bind:this={dialog}
	role="dialog"
	aria-label="Notifications"
	tabindex="-1"
	class="glass-strong sheet fixed z-50 flex flex-col outline-none md:top-1/2 md:left-1/2 md:w-[min(420px,calc(100vw-2rem))] md:-translate-x-1/2 md:-translate-y-1/2 md:rounded-panel"
	transition:enter
>
	<header class="flex justify-end px-3 pt-3">
		<button
			type="button"
			class="icon-btn"
			aria-label="Close"
			onclick={close}
		>
			<X size={16} />
		</button>
	</header>
	{#key view.heading}
		<div class="-mt-5 px-5 md:px-6" in:fade={motion({ duration: 180 })}>
			<div class="grid size-12 place-items-center rounded-2xl bg-accent/10 text-accent">
				<view.icon size={26} weight="fill" />
			</div>
			<h2 class="mt-4 text-[19px] leading-snug font-semibold tracking-tight text-balance">{view.heading}</h2>
			{#each view.body as paragraph (paragraph)}
				<p class="mt-2 text-[14px] leading-relaxed text-muted touch:text-[15px]">{paragraph}</p>
			{/each}
			{#if view.steps}
				<ol class="mt-4 space-y-1.5" aria-label="Steps">
					{#each view.steps as step, i (i)}
						<li class="flex items-center gap-3 rounded-2xl bg-ink/[0.04] px-3.5 py-2.5 text-[14px] touch:text-[15px]">
							<span class="grid size-6 shrink-0 place-items-center rounded-full bg-accent text-[12px] font-semibold text-on-accent">{i + 1}</span>
							<span class="flex-1"
								>{#each step.parts as part, j (j)}{#if typeof part === 'string'}{part}{:else}<strong class="font-semibold">{part.strong}</strong>{/if}{/each}</span
							>
							<step.icon size={20} class="shrink-0 text-muted" />
						</li>
					{/each}
				</ol>
			{/if}
		</div>
	{/key}
	<footer class="flex flex-col-reverse gap-2 p-4 pt-5 md:flex-row md:justify-end md:px-6 md:pb-5">
		{#each view.actions as action (action.label)}
			<button
				type="button"
				class="btn {action.primary ? 'btn-primary' : 'btn-quiet'}"
				disabled={action.disabled}
				onclick={action.run}
			>
				{action.label}
			</button>
		{/each}
	</footer>
</div>
