import { parseQuickAdd, type TokenKind } from 'shared/quick-add.ts';
import { NO_DEFAULTS, type ListDefaults } from 'shared/screens.ts';
import { creationHome } from 'shared/space-routing.ts';
import type { Due, Priority, Recurrence } from 'shared/task.ts';
import { applyPickedLabels } from 'shared/triggers.ts';
import {
	cutTokens,
	draftTask,
	initialPicked,
	labelPick,
	merged,
	shownLabelIds,
	type Picked,
} from './quick-add-draft.ts';
import { addableLabels, addableProjects } from './screen.ts';
import { store } from './store.svelte.ts';
import { clock } from './ui.svelte.ts';

/** The quick add sheet's state: the typed text and the picked values, with the rules in `quick-add-draft.ts`. */
export class QuickAddDraft {
	text = $state('');
	picked: Picked = $state(initialPicked(NO_DEFAULTS));

	/** What the draft starts from: the sheet's opening defaults, then each restart's. */
	defaults: ListDefaults = $state.raw(NO_DEFAULTS);

	constructor(defaults: ListDefaults) {
		this.restart(defaults);
	}

	/** Clears the draft for the next task in the same sheet, starting from `next`. */
	restart(next: ListDefaults) {
		this.defaults = next;
		this.text = '';
		this.picked = initialPicked(next);
	}

	/** Every space's projects and labels a new task may land on. Picking one moves the task into its space. */
	projects = $derived(addableProjects());
	labels = $derived(addableLabels());
	sections = $derived(store.sections.filter(s => this.projects.some(p => p.id === s.projectId)));

	parsed = $derived(
		parseQuickAdd(this.text, {
			now: new Date(clock.now),
			projects: this.projects,
			sections: this.sections,
			labels: this.labels,
			projectId: this.picked.projectId,
			due: this.picked.due,
		}),
	);
	merged = $derived(merged(this.parsed, this.picked));
	labelIds = $derived(shownLabelIds(this.parsed, this.picked, store.labels));
	/** The labels and place that save. A saved place checked or typed wins over the screen's place. */
	applied = $derived(applyPickedLabels(store.labels, this.labelIds, this.picked.location));
	/** The space the task will land in. A shared one offers only its own labels and creates none, as in task details. */
	home = $derived(creationHome(store.homes, { projectId: this.merged.projectId, labelIds: this.labelIds }, null));
	reminderTokens = $derived(this.parsed.tokens.filter(t => t.kind === 'reminder'));

	/**
	 * A manual pick replaces whatever the text said for that attribute. The parser shows only the last copy of a
	 * repeated phrase, so each cut reparses until no copy is left to take over from the pick.
	 */
	clearToken(kind: TokenKind) {
		for (let token = this.tokenOf(kind); token; token = this.tokenOf(kind)) this.text = cutTokens(this.text, [token]);
	}

	pickDue(due: Due | null) {
		this.clearToken('due');
		this.picked.due = due;
	}

	pickPriority(priority: Priority) {
		this.clearToken('priority');
		this.picked.priority = priority;
	}

	pickPlace(projectId: string | null, sectionId: string | null) {
		this.clearToken('section');
		this.clearToken('project');
		this.picked.projectId = projectId;
		this.picked.sectionId = sectionId;
	}

	/** A repeat picked here replaces a typed one, and moves the date when the repeat starts on another day. */
	pickRecurrence(recurrence: Recurrence | null, start: Due | null) {
		this.clearToken('recurrence');
		this.picked.recurrence = recurrence;
		if (JSON.stringify(start) !== JSON.stringify(this.merged.due)) this.pickDue(start);
	}

	pickLabels(next: readonly string[]) {
		const { cut, labelIds } = labelPick(next, this.parsed, this.picked, store.labels);
		this.text = cutTokens(this.text, cut);
		this.picked.labelIds = labelIds;
	}

	/** The place chip's `x`: the typed and picked place go, the labels stay. */
	clearPlace() {
		this.pickLabels(this.labelIds.filter(id => !store.label(id)?.place));
		this.picked.location = null;
	}

	task() {
		return draftTask(this.parsed, this.picked, store.labels);
	}

	private tokenOf(kind: TokenKind) {
		return this.parsed.tokens.find(t => t.kind === kind);
	}
}
