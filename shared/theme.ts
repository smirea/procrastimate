import { z } from 'zod';

/** A device-local choice: follow the system, or keep light or dark. See `docs/decisions/theming.md`. */
export const themeChoiceSchema = z.enum(['system', 'light', 'dark']).meta({ id: 'ThemeChoice' });
export type ThemeChoice = z.infer<typeof themeChoiceSchema>;
export const themeChoices = themeChoiceSchema.options;
