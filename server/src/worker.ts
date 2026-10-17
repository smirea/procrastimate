import { instrumentDurableObjectWithSentry, withSentry } from '@sentry/cloudflare';
import { Account as AccountObject } from './account/account';
import api from './api';
import { sentryOptions } from './sentry';

/** The Cloudflare entry `wrangler.jsonc` names. The Bun dev server serves `api.ts` without Sentry. */

export const Account = instrumentDurableObjectWithSentry(sentryOptions, AccountObject);

// A copy, because `withSentry` patches the handler object it is given.
export default withSentry(sentryOptions, { fetch: api.fetch });
