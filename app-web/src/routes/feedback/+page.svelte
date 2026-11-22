<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import { page } from '$app/state';
	import ArrowSquareOut from 'phosphor-svelte/lib/ArrowSquareOut';
	import Check from 'phosphor-svelte/lib/Check';
	import Rows from 'phosphor-svelte/lib/Rows';
	import type { FeedbackProject } from 'shared/api/contract.ts';
	import type { Person } from 'shared/sharing.ts';
	import PersonName from '#lib/components/PersonName.svelte';
	import ProjectGlyph from '#lib/components/ProjectGlyph.svelte';
	import SignIn from '#lib/components/SignIn.svelte';
	import { api, isUnauthorized } from '#lib/api.ts';
	import {
		FEEDBACK_CANCELLED,
		FEEDBACK_POSTED,
		FEEDBACK_READY,
		loadLastFeedbackProject,
		parseDraftMessage,
		pickFeedbackProjects,
		postFeedbackTask,
		saveLastFeedbackProject,
		startingFeedbackProject,
		stashDraft,
		takeStashedDraft,
		type FeedbackDraft,
		type FeedbackPlace,
	} from '#lib/feedback-popup.ts';
	import { session } from '#lib/session.svelte.ts';

	const nonce = $derived(page.url.searchParams.get('nonce') ?? '');
	const callbackURL = $derived(nonce ? `/feedback?nonce=${encodeURIComponent(nonce)}` : '/feedback');

	type AuthState = 'checking' | 'in' | 'out';
	type Posted = { id: string; url: string; destination: string };

	let auth = $state<AuthState>('checking');
	let user = $state<Person | null>(null);
	let allProjects = $state<FeedbackProject[]>([]);
	let loadingProjects = $state(false);
	let loadError = $state<string | null>(null);

	let draft = $state<FeedbackDraft | null>(null);
	let openerOrigin = $state<string | null>(null);
	let waiting = $state(true);
	let thumbURL = $state<string | null>(null);

	let name = $state('');
	let place = $state<FeedbackPlace>({});
	let chosen = false;
	let step = $state<string | null>(null);
	let postError = $state<string | null>(null);
	let posted = $state<Posted | null>(null);

	const posting = $derived(step !== null);
	const openerHost = $derived.by(() => {
		if (!openerOrigin) return null;
		try {
			return new URL(openerOrigin).host;
		} catch {
			return openerOrigin;
		}
	});

	const selection = $derived(
		user && draft
			? pickFeedbackProjects(allProjects, user.id, { space: draft.space, projects: draft.projects })
			: { projects: [] as FeedbackProject[], missing: [] as string[] },
	);
	const projects = $derived(selection.projects);
	const missingError = $derived.by(() => {
		if (!user || !draft || loadingProjects) return null;
		const missing = [...selection.missing];
		if (draft.project && !startingFeedbackProject(projects, { project: draft.project }, undefined)) {
			missing.push(draft.project);
		}
		if (!missing.length) return null;
		const names = [...new Set(missing)].map((item) => `"${item}"`).join(', ');
		return `ProcrastiMate has no editable project named ${names} for ${user.name}`;
	});
	const unresolved = $derived(!place.projectId);

	function applyPlaceDefaults() {
		if (!user || !draft) return;
		const last = loadLastFeedbackProject(user.id);
		if (!chosen) {
			place = { projectId: startingFeedbackProject(projects, { project: draft.project }, last) };
		}
		const current = projects.find((project) => project.id === place.projectId);
		if (!current) {
			place = { projectId: projects[0]?.id };
		} else if (place.sectionId && !current.sections.some((section) => section.id === place.sectionId)) {
			place = { projectId: current.id };
		}
	}

	function acceptDraft(next: FeedbackDraft, origin: string | null) {
		draft = next;
		openerOrigin = origin;
		waiting = false;
		name = next.title;
		if (thumbURL) URL.revokeObjectURL(thumbURL);
		thumbURL = URL.createObjectURL(next.image.thumb);
		if (auth === 'in') applyPlaceDefaults();
	}

	async function loadProjects() {
		loadingProjects = true;
		loadError = null;
		try {
			const response = await api.feedback.projects({ query: {} });
			user = response.user;
			allProjects = response.projects;
			auth = 'in';
			applyPlaceDefaults();
		} catch (error) {
			if (isUnauthorized(error)) {
				session.clear();
				user = null;
				allProjects = [];
				auth = 'out';
			} else {
				loadError = error instanceof Error ? error.message : 'Couldn’t load your ProcrastiMate projects.';
				if (auth === 'checking') auth = 'in';
			}
		} finally {
			loadingProjects = false;
		}
	}

	/** Reload projects immediately after an in-page email sign-in or sign-up succeeds. */
	$effect(() => {
		if (session.state === 'in' && auth === 'out') {
			untrack(() => void loadProjects());
		}
	});

	async function switchAccount() {
		chosen = false;
		user = null;
		allProjects = [];
		auth = 'out';
		await session.signOut();
	}

	function cancel() {
		if (window.opener && openerOrigin && nonce) {
			window.opener.postMessage({ type: FEEDBACK_CANCELLED, nonce }, openerOrigin);
		}
		window.close();
	}

	async function submit(event: SubmitEvent) {
		event.preventDefault();
		if (!draft || !user || posting || unresolved || !name.trim()) return;
		postError = null;
		step = 'Preparing upload';
		const picked = projects.find((project) => project.id === place.projectId);
		try {
			const result = await postFeedbackTask(draft, name.trim(), place, picked, (next) => (step = next));
			saveLastFeedbackProject(user.id, picked?.id);
			posted = result;
			step = null;
			if (window.opener && openerOrigin && nonce) {
				window.opener.postMessage(
					{
						type: FEEDBACK_POSTED,
						nonce,
						id: result.id,
						destination: result.destination,
						url: result.url,
					},
					openerOrigin,
				);
				window.close();
			}
		} catch (error) {
			postError = error instanceof Error ? error.message : 'Couldn’t add the task to ProcrastiMate.';
			step = null;
		}
	}

	onMount(() => {
		void loadProjects();

		const onMessage = (event: MessageEvent) => {
			if (window.opener && event.source !== window.opener) return;
			const parsed = parseDraftMessage(event.data, nonce);
			if (!parsed) return;
			acceptDraft(parsed, event.origin);
		};
		window.addEventListener('message', onMessage);

		void (async () => {
			const stashed = await takeStashedDraft(nonce);
			if (stashed && !draft) {
				acceptDraft(stashed.draft, stashed.openerOrigin);
				return;
			}
			if (window.opener && nonce) {
				window.opener.postMessage({ type: FEEDBACK_READY, nonce }, '*');
			} else {
				waiting = false;
			}
		})();

		return () => {
			window.removeEventListener('message', onMessage);
			if (thumbURL) URL.revokeObjectURL(thumbURL);
		};
	});
</script>

<svelte:head><title>Add to ProcrastiMate</title></svelte:head>

{#snippet projectRow(project: FeedbackProject, showOwner: boolean)}
	{@const open = project.id === place.projectId && project.sections.length > 0}
	{@const picked = project.id === place.projectId && !open}
	<div class="flex border-b border-ink/[0.07] last:border-b-0">
		<button
			type="button"
			role="option"
			aria-selected={picked}
			disabled={posting}
			class="flex min-h-11 min-w-0 flex-1 items-center gap-2.5 px-3 py-2 text-left text-[15px] transition hover:bg-ink/[0.04] disabled:opacity-50"
			onclick={() => {
				chosen = true;
				place = { projectId: project.id };
			}}
		>
			<ProjectGlyph {project} size={17} class="shrink-0 text-muted" />
			<span class="min-w-0 flex-1">
				<span class="block truncate text-ink">{project.name}</span>
				{#if showOwner && project.owner}
					<span class="block truncate text-[12px] text-faint">Shared by <PersonName person={project.owner} /></span>
				{/if}
			</span>
			{#if picked}<Check size={16} weight="bold" class="shrink-0 text-accent" />{/if}
		</button>
		<a
			href={`/projects/${encodeURIComponent(project.id)}`}
			target="_blank"
			rel="noopener"
			aria-label={`Open ${project.name} in ProcrastiMate`}
			title="Open in ProcrastiMate"
			class="grid w-11 shrink-0 place-items-center border-l border-ink/[0.07] text-muted transition hover:bg-ink/[0.04] hover:text-ink"
		>
			<ArrowSquareOut size={16} />
		</a>
	</div>
	{#if open}
		<div class="border-b border-ink/[0.07] bg-ink/[0.02] last:border-b-0">
			<button
				type="button"
				role="option"
				aria-selected={!place.sectionId}
				disabled={posting}
				class="flex min-h-11 w-full items-center gap-2.5 py-2 pr-3 pl-10 text-left text-[14px] text-muted transition hover:bg-ink/[0.04] disabled:opacity-50"
				onclick={() => {
					chosen = true;
					place = { projectId: project.id };
				}}
			>
				<span class="min-w-0 flex-1 truncate">No section</span>
				{#if !place.sectionId}<Check size={15} weight="bold" class="shrink-0 text-accent" />{/if}
			</button>
			{#each project.sections as section (section.id)}
				<button
					type="button"
					role="option"
					aria-selected={place.sectionId === section.id}
					disabled={posting}
					class="flex min-h-11 w-full items-center gap-2.5 border-t border-ink/[0.05] py-2 pr-3 pl-10 text-left text-[14px] text-ink transition hover:bg-ink/[0.04] disabled:opacity-50"
					onclick={() => {
						chosen = true;
						place = { projectId: project.id, sectionId: section.id };
					}}
				>
					<Rows size={14} class="shrink-0 text-faint" />
					<span class="min-w-0 flex-1 truncate">{section.name}</span>
					{#if place.sectionId === section.id}<Check size={15} weight="bold" class="shrink-0 text-accent" />{/if}
				</button>
			{/each}
		</div>
	{/if}
{/snippet}

{#if posted}
	<main class="flex min-h-dvh flex-col items-center justify-center p-4">
		<div class="glass-strong flex w-full max-w-sm flex-col gap-3 rounded-3xl p-6 text-center">
			<h1 class="text-[20px] font-semibold tracking-tight text-ink">Added to {posted.destination}</h1>
			<p class="text-[14px] text-muted">Your feedback task is in ProcrastiMate with its screenshot and report attached.</p>
			<a href={posted.url} class="btn press bg-accent text-on-accent">Open in ProcrastiMate</a>
			<button type="button" class="btn press" onclick={() => window.close()}>Close</button>
		</div>
	</main>
{:else if auth === 'out'}
	<SignIn
		{callbackURL}
		note={draft?.app ? `Sign in to post feedback from ${draft.app}.` : 'Sign in to post feedback to your ProcrastiMate account.'}
		onbeforeoauth={async () => {
			if (draft && nonce) await stashDraft(nonce, draft, openerOrigin);
		}}
	/>
{:else if !draft}
	<main class="flex min-h-dvh flex-col items-center justify-center p-4">
		<div class="glass-strong flex w-full max-w-sm flex-col gap-3 rounded-3xl p-6 text-center">
			<h1 class="text-[20px] font-semibold tracking-tight text-ink">
				{waiting ? 'Loading feedback…' : 'Add to ProcrastiMate'}
			</h1>
			<p class="text-[14px] text-muted">
				{waiting
					? 'Waiting for the capture from the page you came from.'
					: 'Open Feedback in an app and choose ProcrastiMate to post a task here.'}
			</p>
			{#if !waiting}
				<a href="/inbox" class="btn press bg-accent text-on-accent">Open ProcrastiMate</a>
			{/if}
		</div>
	</main>
{:else}
	<form class="mx-auto flex min-h-dvh max-w-lg flex-col" onsubmit={submit}>
		<header class="sticky top-0 z-10 flex items-center justify-between gap-2 border-b border-ink/[0.07] bg-[var(--canvas)]/90 px-3 py-2 backdrop-blur-md">
			<button
				type="button"
				disabled={posting}
				class="min-h-11 rounded-full px-3 text-[15px] text-muted transition hover:bg-ink/[0.05] hover:text-ink disabled:opacity-40"
				onclick={cancel}
			>
				Cancel
			</button>
			<h1 class="truncate text-[16px] font-semibold tracking-tight text-ink">Add to ProcrastiMate</h1>
			<button
				type="submit"
				disabled={posting || unresolved || !name.trim()}
				class="min-h-11 rounded-full bg-accent px-4 text-[15px] font-semibold text-on-accent transition disabled:opacity-40"
			>
				{posting ? 'Adding…' : 'Add'}
			</button>
		</header>

		<div class="flex flex-1 flex-col gap-4 p-4">
			<div class="glass flex items-center gap-3 rounded-2xl p-3">
				{#if thumbURL}
					<img
						src={thumbURL}
						alt="Annotated feedback screenshot"
						class="h-14 w-14 shrink-0 rounded-xl border border-ink/10 object-cover object-top"
					/>
				{/if}
				<div class="min-w-0 flex-1">
					{#if draft.app || openerHost}
						<p class="truncate text-[14px] font-medium text-ink">
							{draft.app ?? openerHost}{#if draft.app && openerHost}{' '}<span class="font-normal text-faint"
									>· {openerHost}</span
								>{/if}
						</p>
					{/if}
					{#if user}
						<p class="truncate text-[13px] text-muted">
							Posting as <span class="font-medium text-ink">{user.name}</span>
						</p>
					{/if}
				</div>
				{#if user}
					<button
						type="button"
						disabled={posting}
						class="min-h-11 shrink-0 rounded-full px-2.5 text-[13px] text-muted transition hover:bg-ink/[0.05] hover:text-ink disabled:opacity-40"
						onclick={switchAccount}
					>
						Switch
					</button>
				{/if}
			</div>

			{#if step}
				<p role="status" class="rounded-2xl bg-ink/[0.05] px-3.5 py-2.5 text-[14px] text-muted">{step}…</p>
			{/if}
			{#if postError}
				<div role="alert" class="rounded-2xl border border-[var(--tone-overdue)]/30 bg-[var(--tone-overdue)]/10 px-3.5 py-2.5 text-[14px] text-[var(--tone-overdue)]">
					{postError}
				</div>
			{/if}
			{#if loadError}
				<div role="alert" class="flex items-center justify-between gap-3 rounded-2xl border border-[var(--tone-overdue)]/30 bg-[var(--tone-overdue)]/10 px-3.5 py-2.5 text-[14px] text-[var(--tone-overdue)]">
					<span>{loadError}</span>
					<button type="button" class="shrink-0 font-medium underline" onclick={loadProjects}>Retry</button>
				</div>
			{/if}
			{#if missingError}
				<div role="alert" class="rounded-2xl border border-[var(--tone-overdue)]/30 bg-[var(--tone-overdue)]/10 px-3.5 py-2.5 text-[14px] text-[var(--tone-overdue)]">
					{missingError}
				</div>
			{/if}

			<label class="flex flex-col gap-1.5">
				<span class="px-1 text-[12px] font-medium tracking-wide text-faint uppercase">Name</span>
				<input
					bind:value={name}
					aria-label="Task name"
					disabled={posting}
					class="h-11 rounded-2xl border border-ink/[0.08] bg-[var(--fill-control)] px-3.5 text-[15px] text-ink outline-none focus:border-accent"
				/>
			</label>

			<div class="flex flex-col gap-1.5">
				<span class="px-1 text-[12px] font-medium tracking-wide text-faint uppercase">
					Project{loadingProjects ? ' · loading…' : ''}
				</span>
				<div
					role="listbox"
					aria-label="Project"
					class="overflow-hidden rounded-2xl border border-ink/[0.08] bg-[var(--fill-control)]"
				>
					{#each projects as project (project.id)}
						{@render projectRow(project, project.owner !== null)}
					{/each}
					{#if !projects.length && !loadingProjects}
						<p class="px-3.5 py-3 text-[14px] text-muted">No matching editable projects.</p>
					{/if}
				</div>
			</div>
		</div>
	</form>
{/if}
