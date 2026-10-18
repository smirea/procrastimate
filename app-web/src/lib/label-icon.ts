import MapPin from 'phosphor-svelte/lib/MapPin';
import Tag from 'phosphor-svelte/lib/Tag';
import type { Label } from 'shared/model.ts';

/** A saved place is a label that holds a place, so it draws a pin wherever labels draw a tag. */
export const labelIcon = (label: Pick<Label, 'place'> | undefined) => (label?.place ? MapPin : Tag);
