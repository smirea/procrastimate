/** One `generateContent` call to Gemini, for the server's text features. The key stays on the server. */

export type GeminiThinking = 'minimal' | 'low' | 'medium' | 'high';
export type GeminiModel = { model: string; thinking: GeminiThinking | null };

const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models';

export class GeminiError extends Error {}

/** The reply's text without its thoughts. Throws `GeminiError` on a refusal or an empty reply. */
export async function generateText(
	apiKey: string,
	model: GeminiModel,
	request: { instructions: string; text: string; json?: unknown },
	signal?: AbortSignal,
): Promise<string> {
	const response = await fetch(`${GEMINI_URL}/${model.model}:generateContent`, {
		method: 'POST',
		headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
		signal,
		body: JSON.stringify({
			systemInstruction: { parts: [{ text: request.instructions }] },
			contents: [{ role: 'user', parts: [{ text: request.text }] }],
			generationConfig: {
				temperature: 0,
				...(request.json !== undefined && { responseMimeType: 'application/json', responseJsonSchema: request.json }),
				...(model.thinking ? { thinkingConfig: { thinkingLevel: model.thinking } } : {}),
			},
		}),
	});
	const body = (await response.json().catch(() => null)) as {
		candidates?: Array<{ content?: { parts?: Array<{ text?: string; thought?: boolean }> } }>;
		error?: { message?: string };
	} | null;
	if (!response.ok) throw new GeminiError(`Gemini ${response.status}: ${body?.error?.message ?? 'no body'}`);
	const text = body?.candidates?.[0]?.content?.parts
		?.filter(part => !part.thought)
		.map(part => part.text ?? '')
		.join('');
	if (!text) throw new GeminiError('Gemini returned no text');
	return text;
}
