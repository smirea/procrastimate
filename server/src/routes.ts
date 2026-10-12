import { ProcedureContract, type AnyContractRouter } from '@orpc/contract';
import { getOpenAPIMeta } from '@orpc/openapi';

/** `METHOD /path` for every procedure in `router`, the keys the Worker forwards and the raw routes use. */
export function routeKeys(router: AnyContractRouter): string[] {
	if (router instanceof ProcedureContract) {
		const meta = getOpenAPIMeta(router);
		if (!meta?.method || !meta.path) throw new Error('Every contract procedure declares its method and path');
		return [`${meta.method} ${meta.path}`];
	}
	return Object.values(router).flatMap(child => routeKeys(child as AnyContractRouter));
}
