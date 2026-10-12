import { isContractProcedure, type AnyContractRouter } from '@orpc/contract';

/** `METHOD /path` for every procedure in `router`, the keys the Worker forwards and the raw routes use. */
export function routeKeys(router: AnyContractRouter): string[] {
	if (isContractProcedure(router)) {
		const { method, path } = router['~orpc'].route;
		return [`${method} ${path}`];
	}
	return Object.values(router).flatMap(child => routeKeys(child as AnyContractRouter));
}
