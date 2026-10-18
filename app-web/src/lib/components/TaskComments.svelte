<script lang="ts">
	import { untrack } from 'svelte';
	import { fly, slide } from 'svelte/transition';
	import { flip } from 'svelte/animate';
	import { cubicOut } from 'svelte/easing';
	import PaperPlaneRight from 'phosphor-svelte/lib/PaperPlaneRight';
	import PencilSimple from 'phosphor-svelte/lib/PencilSimple';
	import Trash from 'phosphor-svelte/lib/Trash';
	import { commentsOn } from 'shared/comments.ts';
	import type { Task } from 'shared/task.ts';
	import LinkedText from './LinkedText.svelte';
	import PersonName from './PersonName.svelte';
	import { api } from '../api.ts';
	import type { Home } from 'shared/space-routing.ts';
	import { session } from '../session.svelte.ts';
	import { store } from '../store.svelte.ts';
	import { clock, motion, toasts } from '../ui.svelte.ts';
	import { followCaret } from '../caret.ts';

	let { task, home }: { task: Task; home: Home } = $props();

	const list = $derived(commentsOn(store.comments, task.id));
	const editable = $derived(store.canEdit(task.id));
	const me = $derived(session.userId);

	let draft = $state('');
	let editing = $state<{ id: string; body: string } | null>(null);

	// Reading the task reads its comments, including ones that arrive while it stays open.
	$effect(() => {
		void list;
		const user = me;
		if (user) untrack(() => store.markCommentsRead(task.id, user));
	});

	/** The people cache names authors offline; an author this device never met asks the server, also mid-visit. */
	const unknownAuthors = $derived(
		[...new Set(list.flatMap((c) => (c.authorId && c.authorId !== me && !store.person(c.authorId) ? [c.authorId] : [])))].join(),
	);
	$effect(() => {
		if (!unknownAuthors || !navigator.onLine) return;
		const query = home === null ? { id: task.id } : { id: task.id, space: home };
		void api.comments
			.list({ query })
			.then((result) => store.rememberPeople(result.comments.map((c) => c.author)))
			.catch(() => undefined);
	});

	function send() {
		if (!me || !draft.trim()) return;
		store.addComment(task.id, draft, me);
		draft = '';
	}

	function save() {
		if (me && editing) store.editComment(editing.id, editing.body, me);
		editing = null;
	}

	function remove(id: string) {
		if (!me) return;
		const removed = store.deleteComment(id, me);
		if (removed) toasts.show('Deleted comment', { label: 'Undo', run: () => store.undeleteComment(removed) });
	}

	/** Enter sends, Shift+Enter breaks the line. */
	function onkeydown(event: KeyboardEvent, submit: () => void, cancel?: () => void) {
		if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
			event.preventDefault();
			submit();
		} else if (event.key === 'Escape' && cancel) {
			event.preventDefault();
			event.stopPropagation();
			cancel();
		}
	}

	const relative = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto', style: 'short' });
	const dated = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });
	function when(at: number) {
		const minutes = Math.round((at - clock.now) / 60_000);
		if (Math.abs(minutes) < 1) return 'just now';
		if (Math.abs(minutes) < 60) return relative.format(minutes, 'minute');
		const hours = Math.round(minutes / 60);
		if (Math.abs(hours) < 24) return relative.format(hours, 'hour');
		return dated.format(at);
	}
</script>

{#if list.length || editable}
	<section class="flex flex-col gap-2 px-1" aria-label="Comments">
		<h2 class="px-1 text-[12px] font-medium tracking-wide text-muted uppercase">Comments</h2>
		{#if list.length}
			<ol class="flex flex-col gap-1" aria-label="Comment list">
				{#each list as comment (comment.id)}
					{@const mine = !!me && comment.authorId === me}
					<li
						class="group rounded-2xl px-3 py-2 transition-colors hover:bg-ink/[0.03]"
						data-comment={comment.body}
						animate:flip={{ duration: 180 }}
						in:fly={motion({ y: 6, duration: 200, easing: cubicOut })}
						out:slide={motion({ duration: 160 })}
					>
						<div class="flex items-baseline gap-2 text-[13px]">
							<PersonName person={store.person(comment.authorId) ?? (mine ? { id: me!, name: '', kind: 'human', ownerId: null } : undefined)} you class="font-medium" />
							<time class="shrink-0 text-[12px] text-faint" datetime={new Date(comment.createdAt).toISOString()}>{when(comment.createdAt)}</time>
							{#if comment.editedAt !== null}<span class="text-[12px] text-faint">edited</span>{/if}
							{#if mine && editable && editing?.id !== comment.id}
								<span class="ml-auto flex shrink-0 gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100 touch:opacity-100">
									<button type="button" class="icon-btn hit-area relative size-7!" aria-label="Edit comment" onclick={() => (editing = { id: comment.id, body: comment.body })}>
										<PencilSimple size={14} />
									</button>
									<button type="button" class="icon-btn hit-area relative size-7!" aria-label="Delete comment" onclick={() => remove(comment.id)}>
										<Trash size={14} />
									</button>
								</span>
							{/if}
						</div>
						{#if editing?.id === comment.id}
							<!-- svelte-ignore a11y_autofocus -->
							<textarea
								aria-label="Edit comment"
								rows="1"
								autofocus
								class="mt-1 block max-h-72 w-full resize-none [field-sizing:content] rounded-xl border border-ink/15 bg-surface/60 px-3 py-2 text-[14px] outline-none touch:text-base"
								bind:value={editing.body}
								use:followCaret
								onkeydown={(e) => onkeydown(e, save, () => (editing = null))}
							></textarea>
							<div class="mt-1.5 flex justify-end gap-1.5">
								<button type="button" class="chip" onclick={() => (editing = null)}>Cancel</button>
								<button type="button" class="chip" data-active="true" onclick={save}>Save</button>
							</div>
						{:else}
							<p class="mt-0.5 text-[14px] whitespace-pre-wrap [overflow-wrap:anywhere] touch:text-base"><LinkedText text={comment.body} /></p>
						{/if}
					</li>
				{/each}
			</ol>
		{/if}
		{#if editable}
			<div class="flex items-end gap-2" transition:slide={motion({ duration: 160 })}>
				<textarea
					aria-label="Add a comment"
					placeholder="Add a comment"
					rows="1"
					class="block max-h-72 min-h-11 w-full resize-none [field-sizing:content] rounded-2xl border border-transparent bg-ink/[0.04] px-3.5 py-2.5 text-[14px] outline-none transition-colors touch:text-base placeholder:text-faint focus:border-ink/15 focus:bg-surface/60"
					bind:value={draft}
					use:followCaret
					onkeydown={(e) => onkeydown(e, send)}
				></textarea>
				<button
					type="button"
					class="send grid size-11 shrink-0 place-items-center rounded-full"
					aria-label="Send comment"
					disabled={!draft.trim()}
					onclick={send}
				>
					<PaperPlaneRight size={18} weight="fill" />
				</button>
			</div>
		{/if}
	</section>
{/if}

<style>
	.send {
		background: var(--color-accent);
		color: var(--color-on-accent);
		transition:
			opacity 160ms,
			scale 220ms var(--ease-spring);
	}

	.send:disabled {
		opacity: 0.35;
	}

	.send:not(:disabled):active {
		scale: 0.9;
	}
</style>
