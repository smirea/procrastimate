import MapPin from 'phosphor-svelte/lib/MapPin';
import Tag from 'phosphor-svelte/lib/Tag';
import type { Label } from 'shared/model.ts';

export const labelIcon = (label: Pick<Label, 'place'> | undefined) => (label?.place ? MapPin : Tag);
