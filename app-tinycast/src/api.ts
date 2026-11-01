import { getPreferenceValues, openExtensionPreferences, showToast, Toast } from '@raycast/api';
import { createORPCClient, ORPCError } from '@orpc/client';
import type { RouterContractClient } from '@orpc/contract';
import type { JsonifiedClient } from '@orpc/openapi';
import { OpenAPILink } from '@orpc/openapi/fetch';
import { agentContract } from 'shared/api/contract.ts';

type Preferences = { token: string; origin: string };

export type AgentClient = JsonifiedClient<RouterContractClient<typeof agentContract>>;

function preferences(): Preferences {
	const { token, origin } = getPreferenceValues<Preferences>();
	if (!token.startsWith('pm.')) throw new Error('The API token must be a ProcrastiMate token starting with pm.');
	return { token, origin: new URL(origin).origin };
}

export function webUrl(path: string): string {
	return `${preferences().origin}${path}`;
}

export function agentClient(): AgentClient {
	const { token, origin } = preferences();
	return createORPCClient(
		new OpenAPILink(agentContract, {
			// The server records a request without the apps' client header as an `api` write from its User-Agent.
			headers: { authorization: `Bearer ${token}`, 'user-agent': 'Tinycast' },
			fetch: (path, init) => fetch(new URL(path, origin), init),
		}),
	);
}

export type Failure = { title: string; message: string; refused: boolean };

export function failureOf(error: unknown, title: string): Failure {
	if (error instanceof ORPCError && error.code === 'UNAUTHORIZED')
		return {
			title: 'ProcrastiMate refused the token',
			message: 'Paste a fresh token from ProcrastiMate’s Settings in the extension preferences.',
			refused: true,
		};
	return { title, message: error instanceof Error ? error.message : String(error), refused: false };
}

export async function showFailure(error: unknown, title: string) {
	const failure = failureOf(error, title);
	await showToast({
		style: Toast.Style.Failure,
		title: failure.title,
		message: failure.message,
		primaryAction: failure.refused
			? { title: 'Open Preferences', onAction: () => void openExtensionPreferences() }
			: undefined,
	});
}
