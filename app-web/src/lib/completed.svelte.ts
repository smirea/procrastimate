import { z } from 'zod';
import type { DateKey } from 'shared/task.ts';
import { dateKeySchema } from 'shared/values.ts';
import { completedPresetSchema, completedRange, type CompletedRange } from 'shared/views.ts';

/** A preset follows today, so it is stored by name; a custom range is stored as its days. */
const choiceSchema = z.union([completedPresetSchema, z.object({ from: dateKeySchema, to: dateKeySchema })]);
export type CompletedChoice = z.infer<typeof choiceSchema>;

/** A project or label view, whose `Show completed` toggle is its own. */
const shownListSchema = z.templateLiteral([z.enum(['project', 'label']), ':', z.string()]);
export type ShownList = z.infer<typeof shownListSchema>;

const RANGE_KEY = 'procrastimate.completedRange';
const SHOW_KEY = 'procrastimate.showCompleted';

function load(): CompletedChoice {
	try {
		return choiceSchema.parse(JSON.parse(localStorage.getItem(RANGE_KEY) ?? '"week"'));
	} catch {
		return 'week';
	}
}

function loadShown(): ReadonlySet<ShownList> {
	try {
		return new Set(z.array(shownListSchema).parse(JSON.parse(localStorage.getItem(SHOW_KEY) ?? '[]')));
	} catch {
		return new Set();
	}
}

class Completed {
	choice = $state<CompletedChoice>(load());
	/** The project and label views that list their completed tasks under the open ones. */
	#shown = $state.raw(loadShown());

	range(today: DateKey): CompletedRange {
		return typeof this.choice === 'string' ? completedRange(this.choice, today) : this.choice;
	}

	choose(choice: CompletedChoice) {
		this.choice = choice;
		localStorage.setItem(RANGE_KEY, JSON.stringify(choice));
	}

	shown(list: ShownList): boolean {
		return this.#shown.has(list);
	}

	toggle(list: ShownList) {
		const next = new Set(this.#shown);
		if (!next.delete(list)) next.add(list);
		this.#shown = next;
		localStorage.setItem(SHOW_KEY, JSON.stringify([...next]));
	}
}

export const completed = new Completed();
