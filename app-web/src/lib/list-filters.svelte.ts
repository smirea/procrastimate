import { z } from 'zod';
import { DEVICE_KEYS } from './device.ts';
import { filterActive, listFilterSchema, NO_FILTER, type ListFilter } from 'shared/list-filters.ts';

const filtersSchema = z.record(z.string(), listFilterSchema);

function load(): Record<string, ListFilter> {
	try {
		return filtersSchema.parse(JSON.parse(localStorage.getItem(DEVICE_KEYS.listFilters) ?? '{}'));
	} catch {
		return {};
	}
}

/** Each list's filter, kept on this device by `filterKey`, so a list opens filtered the way it was left. */
class ListFilters {
	#filters = $state.raw(load());

	get(key: string): ListFilter {
		return this.#filters[key] ?? NO_FILTER;
	}

	set(key: string, filter: ListFilter) {
		const { [key]: _, ...rest } = this.#filters;
		this.#filters = filterActive(filter) ? { ...rest, [key]: filter } : rest;
		localStorage.setItem(DEVICE_KEYS.listFilters, JSON.stringify(this.#filters));
	}
}

export const listFilters = new ListFilters();
