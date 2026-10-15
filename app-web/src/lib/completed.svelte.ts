import { z } from 'zod';
import type { DateKey } from 'shared/task.ts';
import { dateKeySchema } from 'shared/values.ts';
import { completedPresetSchema, completedRange, type CompletedRange } from 'shared/views.ts';

/** A preset follows today, so it is stored by name; a custom range is stored as its days. */
const choiceSchema = z.union([completedPresetSchema, z.object({ from: dateKeySchema, to: dateKeySchema })]);
export type CompletedChoice = z.infer<typeof choiceSchema>;

const RANGE_KEY = 'procrastimate.completedRange';
const SHOW_KEY = 'procrastimate.showCompleted';

function load(): CompletedChoice {
	try {
		return choiceSchema.parse(JSON.parse(localStorage.getItem(RANGE_KEY) ?? '"week"'));
	} catch {
		return 'week';
	}
}

class Completed {
	choice = $state<CompletedChoice>(load());
	/** Whether project and label views list their completed tasks under the open ones. */
	shown = $state(localStorage.getItem(SHOW_KEY) !== null);

	range(today: DateKey): CompletedRange {
		return typeof this.choice === 'string' ? completedRange(this.choice, today) : this.choice;
	}

	choose(choice: CompletedChoice) {
		this.choice = choice;
		localStorage.setItem(RANGE_KEY, JSON.stringify(choice));
	}

	toggle() {
		this.shown = !this.shown;
		if (this.shown) localStorage.setItem(SHOW_KEY, '1');
		else localStorage.removeItem(SHOW_KEY);
	}
}

export const completed = new Completed();
