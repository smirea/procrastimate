import { USER_HEADER } from '../../shared/auth';

/**
 * The Durable Object trusts `x-procrastinate-user` only after the Worker has checked the session. Cloning the
 * request sets that header. Bun's WebSocket upgrade still needs the request the server received, so the clone
 * remembers it.
 */
const originals = new WeakMap<Request, Request>();

export function withUser(request: Request, userId: string): Request {
	const headers = new Headers(request.headers);
	headers.delete(USER_HEADER);
	headers.set(USER_HEADER, userId);
	const next = new Request(request, { headers });
	originals.set(next, originals.get(request) ?? request);
	return next;
}

/** The request Bun can upgrade, when `request` is a clone made to attach the user. */
export function originalRequest(request: Request): Request {
	return originals.get(request) ?? request;
}
