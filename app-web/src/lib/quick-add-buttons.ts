import type { Component } from 'svelte';
import type { IconComponentProps } from 'phosphor-svelte';
import Bell from 'phosphor-svelte/lib/Bell';
import CalendarBlank from 'phosphor-svelte/lib/CalendarBlank';
import Flag from 'phosphor-svelte/lib/Flag';
import ImageSquare from 'phosphor-svelte/lib/ImageSquare';
import ListChecks from 'phosphor-svelte/lib/ListChecks';
import Repeat from 'phosphor-svelte/lib/Repeat';
import Tag from 'phosphor-svelte/lib/Tag';
import { QUICK_ADD_BUTTONS, type QuickAddButton } from 'shared/quick-add-buttons.ts';

/** Location and event are set on iPhone only, so the web never offers them. */
export type WebButton = Exclude<QuickAddButton, 'location' | 'event'>;
export const WEB_BUTTONS = QUICK_ADD_BUTTONS.filter(
	(button): button is WebButton => button !== 'location' && button !== 'event',
);

export const BUTTON_INFO: Record<WebButton, { name: string; icon: Component<IconComponentProps> }> = {
	date: { name: 'Date', icon: CalendarBlank },
	priority: { name: 'Priority', icon: Flag },
	reminders: { name: 'Reminders', icon: Bell },
	repeat: { name: 'Repeat', icon: Repeat },
	labels: { name: 'Labels', icon: Tag },
	subtasks: { name: 'Subtasks', icon: ListChecks },
	images: { name: 'Images', icon: ImageSquare },
};
