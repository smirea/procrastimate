import type { AuthMethods } from 'shared/api/contract.ts';
import { api } from './api.ts';
import { store } from './store.svelte.ts';
import { toasts } from './ui.svelte.ts';

/**
 * The signed-in user. The session cookie is httpOnly, so a cached user id is what lets the app open offline.
 * `procrastimate-owner` is who the local document belongs to, and it stays after sign-out so the next account
 * does not upload the previous one's tasks.
 */

const USER_KEY = 'procrastimate-user';
const OWNER_KEY = 'procrastimate-owner';

type State = 'checking' | 'in' | 'out';

const cachedUser = () => (typeof localStorage === 'undefined' ? null : localStorage.getItem(USER_KEY));

class Session {
	/** `in` immediately when a user id is cached, so a day offline never shows the sign-in screen. */
	state = $state<State>(cachedUser() ? 'in' : 'checking');
	userId = $state(cachedUser());
	/** True once the session check has settled, so sync does not upload before a user switch clears the document. */
	confirmed = $state(false);
	methods = $state<AuthMethods>({
		email: false,
		google: false,
		apple: false,
		googleIosClientId: null,
		appleNative: false,
	});
	error = $state('');

	async start() {
		await this.refresh();
		this.confirmed = true;
		void this.loadMethods();
	}

	async refresh() {
		let response: Response;
		try {
			response = await fetch('/api/auth/get-session', { credentials: 'include' });
		} catch {
			if (!cachedUser()) this.state = 'out';
			return;
		}
		if (response.status === 401 || response.status === 503) {
			this.clear();
			return;
		}
		if (!response.ok) {
			if (!cachedUser()) this.state = 'out';
			return;
		}
		const body = (await response.json().catch(() => null)) as { user?: { id?: string } } | null;
		if (!body?.user?.id) {
			this.clear();
			return;
		}
		this.adopt(body.user.id);
	}

	/** Remembers the user. A different owner replaces the local document with an empty pull, not an upload. */
	adopt(id: string) {
		const owner = localStorage.getItem(OWNER_KEY);
		if (owner && owner !== id) store.switchUser();
		localStorage.setItem(USER_KEY, id);
		localStorage.setItem(OWNER_KEY, id);
		this.userId = id;
		this.state = 'in';
		this.error = '';
	}

	/** Drops the cached session. The owner id stays, and so does the local document. */
	clear() {
		localStorage.removeItem(USER_KEY);
		this.userId = null;
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
			body: JSON.stringify({ provider, callbackURL: '/inbox' }),
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
		const response = await fetch('/api/auth/sign-out', { method: 'POST', credentials: 'include' }).catch(() => null);
		if (response?.ok || !id || this.state !== 'out') return;
		this.adopt(id);
		toasts.show('Could not sign out');
	}

	/** Not optimistic: it cannot be undone, so the account stays until the server confirms. */
	async deleteAccount(): Promise<boolean> {
		const deleted = await api.account.delete().catch(() => null);
		if (!deleted) {
			toasts.show('Could not delete the account');
			return false;
		}
		store.switchUser();
		localStorage.removeItem(OWNER_KEY);
		this.clear();
		return true;
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
			this.error = response.status === 401 ? 'Wrong email or password' : 'Could not sign in';
			return;
		}
		const payload = (await response.json().catch(() => null)) as { user?: { id?: string } } | null;
		if (payload?.user?.id) this.adopt(payload.user.id);
		else await this.refresh();
	}

	async loadMethods() {
		const methods = await api.auth.methods().catch(() => null);
		if (methods) this.methods = methods;
	}
}

export const session = new Session();
