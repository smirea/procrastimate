import type { AuthMethods, SyncToken } from 'shared/api/contract.ts';
import { DEVICE_KEYS } from './device.ts';
import { api, isUnauthorized } from './api.ts';
import { identify, type SentryUser } from './sentry.ts';
import { store } from './store.svelte.ts';
import { toasts } from './ui.svelte.ts';

/** The session cookie is httpOnly, so a cached user id is what lets the app open offline. */

const USER_KEY = DEVICE_KEYS.user;

type State = 'checking' | 'in' | 'out';
type Credentials = Omit<SyncToken, 'user'>;

const cachedUser = () => (typeof localStorage === 'undefined' ? null : localStorage.getItem(USER_KEY));

class Session {
	/** `in` immediately when a user id is cached, so a day offline never shows the sign-in screen. */
	state = $state<State>(cachedUser() ? 'in' : 'checking');
	userId = $state(cachedUser());
	/** True once the session check has settled, so sync does not connect before a user switch clears the database. */
	confirmed = $state(false);
	methods = $state<AuthMethods>({
		email: false,
		google: false,
		apple: false,
		googleIosClientId: null,
		appleNative: false,
	});
	error = $state('');

	/** Opens the cached user's database at once, so the first frame needs no network. */
	constructor() {
		if (this.userId) void store.open(this.userId);
	}

	/** The session check fetches a sync token anyway, so the first connect uses it instead of asking again. */
	#credentials: Credentials | null = null;

	async start() {
		identify(this.userId ? { id: this.userId } : null);
		await this.refresh();
		this.confirmed = true;
	}

	/**
	 * The sync token route is the session check: a 401 signs out, and any other failure, offline above all, keeps the
	 * cached user.
	 */
	async refresh() {
		try {
			const { user, ...credentials } = await api.sync.token();
			this.#credentials = credentials;
			this.adopt(user);
		} catch (error) {
			if (isUnauthorized(error)) this.clear();
			else if (!cachedUser()) this.state = 'out';
		}
	}

	takeCredentials(): Credentials | null {
		const credentials = this.#credentials;
		this.#credentials = null;
		return credentials;
	}

	adopt(user: SentryUser) {
		const { id } = user;
		void store.open(id);
		localStorage.setItem(USER_KEY, id);
		this.userId = id;
		identify(user);
		this.state = 'in';
		this.error = '';
	}

	/** The local database stays, with its owner. */
	clear() {
		this.#credentials = null;
		localStorage.removeItem(USER_KEY);
		this.userId = null;
		identify(null);
		this.state = 'out';
	}

	async signIn(email: string, password: string) {
		await this.#submit('/api/auth/sign-in/email', { email, password });
	}

	async signUp(email: string, password: string) {
		const name = email.split('@')[0] || 'ProcrastiMate';
		await this.#submit('/api/auth/sign-up/email', { email, password, name });
	}

	async social(provider: 'google' | 'apple') {
		this.error = '';
		const response = await fetch('/api/auth/sign-in/social', {
			method: 'POST',
			credentials: 'include',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ provider, callbackURL: '/inbox', errorCallbackURL: '/inbox' }),
		}).catch(() => null);
		const body = (await response?.json().catch(() => null)) as { url?: string } | null;
		if (!response?.ok || !body?.url) {
			this.error = 'Could not sign in';
			return;
		}
		location.href = body.url;
	}

	/** Signs out at once. The cookie is httpOnly, so a refused sign-out would sign back in on reload; it comes back now instead. */
	async signOut() {
		const id = this.userId;
		this.clear();
		// The Worker sees an empty body even without one, and Better Auth refuses a body with no content type (415).
		const response = await fetch('/api/auth/sign-out', {
			method: 'POST',
			credentials: 'include',
			headers: { 'content-type': 'application/json' },
			body: '{}',
		}).catch(() => null);
		if (response?.ok || !id || this.state !== 'out') return;
		this.adopt({ id });
		toasts.show('Could not sign out');
	}

	async #submit(path: string, body: object) {
		this.error = '';
		let response: Response;
		try {
			response = await fetch(path, {
				method: 'POST',
				credentials: 'include',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(body),
			});
		} catch {
			this.error = 'Could not sign in';
			return;
		}
		if (!response.ok) {
			const failure = (await response.json().catch(() => null)) as { code?: string; message?: string } | null;
			this.error =
				failure?.code === 'REGISTRATION_CLOSED' && failure.message
					? failure.message
					: response.status === 401
						? 'Wrong email or password'
						: 'Could not sign in';
			return;
		}
		const payload = (await response.json().catch(() => null)) as { user?: Partial<SentryUser> } | null;
		if (payload?.user?.id) this.adopt({ ...payload.user, id: payload.user.id });
		else await this.refresh();
	}

	/** Only the sign-in screen shows them, so a signed-in launch never asks. */
	async loadMethods() {
		if (this.methods.email) return;
		const methods = await api.auth.methods().catch(() => null);
		if (methods) this.methods = methods;
	}
}

export const session = new Session();
