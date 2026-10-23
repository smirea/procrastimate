import { z } from 'zod';

/**
 * Where speech becomes text. Native is the platform recognizer. ElevenLabs is the server Scribe path, and it runs
 * only when it is selected and the device is online. Offline is always native.
 */
export const DICTATION_CHOICES = ['native', 'elevenlabs'] as const;
export const dictationChoiceSchema = z.enum(DICTATION_CHOICES).meta({ id: 'DictationChoice' });
export type DictationChoice = z.infer<typeof dictationChoiceSchema>;

/**
 * How Ramble reads speech. `smart` is Gemini on the server, with the grammar offline or when it fails. `commands` is
 * the grammar reading only spoken cues: `new task`, `subtask`, `note`, priorities, and dates.
 */
export const RAMBLE_MODES = ['smart', 'commands'] as const;
export const rambleModeSchema = z.enum(RAMBLE_MODES).meta({ id: 'RambleMode' });
export type RambleMode = z.infer<typeof rambleModeSchema>;

export const DICTATION_CAPTURES = ['speech', 'socket', 'typed'] as const;
export const dictationCaptureSchema = z.enum(DICTATION_CAPTURES).meta({ id: 'DictationCapture' });
export type DictationCapture = z.infer<typeof dictationCaptureSchema>;

export const voiceCaptureSchema = z
	.object({
		engine: z.enum(['native', 'elevenlabs']),
		capture: dictationCaptureSchema,
	})
	.meta({ id: 'VoiceCapture' });
export type VoiceCapture = z.infer<typeof voiceCaptureSchema>;

/**
 * The capture a voice session starts with. `speech` is the platform recognizer. `socket` is the Ramble
 * ElevenLabs socket. `typed` is the fallback when the platform has no recognizer the app can start: the
 * transcript field stays editable, so typing and the operating system's own dictation still reach the grammar.
 * ElevenLabs is never that fallback.
 */
export function voiceCapture(choice: DictationChoice, online: boolean, nativeSpeech: boolean): VoiceCapture {
	if (choice === 'elevenlabs' && online) return { engine: 'elevenlabs', capture: 'socket' };
	return { engine: 'native', capture: nativeSpeech ? 'speech' : 'typed' };
}
