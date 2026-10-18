import { COMMON_ERROR_STATUS_MAP, ORPCError } from '@orpc/server';

type Code = keyof typeof COMMON_ERROR_STATUS_MAP;

/**
 * An error answered outside an oRPC handler, in oRPC's body.
 * The client decodes any other body as a malformed response, which loses the code it branches on.
 */
export const errorResponse = (code: Code, message: string) =>
	Response.json(new ORPCError(code, { message }).toJSON(), { status: COMMON_ERROR_STATUS_MAP[code] });
