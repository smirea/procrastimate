import { z } from 'zod';

/**
 * The Ramble socket: the client streams microphone audio and the server answers with the live transcript, which it
 * gets from ElevenLabs Scribe v2 Realtime. Authentication matches the sync nudge socket: the web sends
 * `RAMBLE_SOCKET_PROTOCOL` and `bearer.<token>` as subprotocols, and a client that can set headers may send
 * `Authorization: Bearer` instead. Language, keyterms, and voice activity settings stay on the server.
 *
 * The client sends binary frames of 16 kHz, 16-bit little-endian mono PCM, 100 ms each, and one `stop` message.
 * The server sends `started` once transcription is live, `partial` and `committed` text, and ends every session it
 * started with one `ended`, after an `error` when it ended on one, then closes the socket.
 */
export const RAMBLE_SOCKET_PATH = '/api/ramble/socket';
export const RAMBLE_SOCKET_PROTOCOL = 'procrastimate.ramble';

export const RAMBLE_SAMPLE_RATE = 16_000;
export const RAMBLE_BYTES_PER_SECOND = RAMBLE_SAMPLE_RATE * 2;
/** One 100 ms frame. */
export const RAMBLE_FRAME_BYTES = RAMBLE_BYTES_PER_SECOND / 10;
/** The largest frame the server accepts, one second of audio. */
export const RAMBLE_MAX_FRAME_BYTES = RAMBLE_BYTES_PER_SECOND;

/** Audio seconds one session may stream before the server ends it. */
export const RAMBLE_SESSION_SECONDS = 5 * 60;
/** Audio seconds all sessions may stream per day in the account's time zone. */
export const RAMBLE_DAILY_SECONDS = 60 * 60;

export const rambleClientMessageSchema = z.object({ type: z.literal('stop') }).meta({ id: 'RambleClientMessage' });
export type RambleClientMessage = z.infer<typeof rambleClientMessageSchema>;

/** Why a session ended: the client stopped, a cap was reached, the socket went quiet, or transcription failed. */
export const RAMBLE_END_REASONS = ['stopped', 'session-limit', 'daily-limit', 'idle', 'error'] as const;
export const rambleEndReasonSchema = z.enum(RAMBLE_END_REASONS).meta({ id: 'RambleEndReason' });
export type RambleEndReason = (typeof RAMBLE_END_REASONS)[number];

/**
 * `daily-limit` refuses a session before it starts, with `resetsAt` as the next midnight. `upstream` means
 * ElevenLabs failed or refused. `invalid-audio` is a frame larger than `RAMBLE_MAX_FRAME_BYTES`.
 */
export const RAMBLE_ERROR_CODES = ['daily-limit', 'upstream', 'invalid-audio'] as const;
export const rambleErrorCodeSchema = z.enum(RAMBLE_ERROR_CODES).meta({ id: 'RambleErrorCode' });
export type RambleErrorCode = (typeof RAMBLE_ERROR_CODES)[number];

export const rambleServerMessageSchema = z
	.discriminatedUnion('type', [
		z.object({ type: z.literal('started') }),
		z.object({ type: z.literal('partial'), text: z.string() }),
		z.object({ type: z.literal('committed'), text: z.string() }),
		z.object({ type: z.literal('ended'), seconds: z.number().nonnegative(), reason: rambleEndReasonSchema }),
		z.object({
			type: z.literal('error'),
			code: rambleErrorCodeSchema,
			message: z.string(),
			resetsAt: z.number().optional(),
		}),
	])
	.meta({ id: 'RambleServerMessage', 'x-inline': true });
export type RambleServerMessage = z.infer<typeof rambleServerMessageSchema>;
