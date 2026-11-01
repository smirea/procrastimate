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
	if (!token.startsWith('pm.')) throw new Error('The API token must be an AI account token starting with pm.');
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

export async function showFailure(error: unknown, title: string) {
	if (error instanceof ORPCError && error.code === 'UNAUTHORIZED') {
		await showToast({
			style: Toast.Style.Failure,
			title: 'ProcrastiMate refused the token',
			message: 'Paste a fresh AI account token in the extension preferences.',
			primaryAction: { title: 'Open Preferences', onAction: () => void openExtensionPreferences() },
		});
		return;
	}
	await showToast({
		style: Toast.Style.Failure,
		title,
		message: error instanceof Error ? error.message : String(error),
	});
}
