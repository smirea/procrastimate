import type { TitleSuggestion } from '../../shared/sharing';
import { renameUntouched, type Command } from './commands';
import { generateText, type GeminiModel } from './gemini';

/**
 * Names a task Feedback created under its placeholder, `<subject>: N changes`, from its items, as the iOS package
 * once did with Apple's on-device model. It runs after the create answers, so posting never waits for it.
 */

/** About a second for a few items; the phrase needs no reasoning. */
export const FEEDBACK_TITLE_GEMINI: GeminiModel = { model: 'gemini-3.5-flash-lite', thinking: 'minimal' };
const TIMEOUT_MS = 10_000;

export const feedbackTitleInstructions =
	'You name tasks for a developer. Given feedback items about an app screen, reply with one lowercase phrase of at ' +
	'most 8 words that covers every item, such as "bigger titles, remove the share button". No quotes, no trailing ' +
	'period, no preamble.';

/** The model's reply on one line without the wrapping it sometimes adds, or `undefined` when nothing is left. */
export function summarizedTitle(suggestion: TitleSuggestion, reply: string): string | undefined {
	const line = reply.split(/[\r\n]+/).find(line => line.trim()) ?? '';
	const summary = line.replace(/^[\s"'“”‘’`*]+|[\s"'“”‘’`*]+$/g, '').replace(/^[.\s]+|[.\s]+$/g, '');
	return summary ? `${suggestion.count} ${suggestion.subject}: ${summary}` : undefined;
}

export async function nameFeedbackTask(
	command: Command,
	id: string,
	placeholder: string,
	suggestion: TitleSuggestion,
	apiKey: string,
): Promise<void> {
	const reply = await generateText(
		apiKey,
		FEEDBACK_TITLE_GEMINI,
		{ instructions: feedbackTitleInstructions, text: suggestion.prompt },
		AbortSignal.timeout(TIMEOUT_MS),
	);
	const title = summarizedTitle(suggestion, reply);
	if (title) await renameUntouched({ ...command, now: Date.now() }, id, placeholder, title);
}
