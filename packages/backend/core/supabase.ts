import { createClient, type SupabaseClient } from "supabaseClient";
import { serverEnv } from "./env.ts";

/**
 * supabase.ts — server-side Supabase client provisioning for the fat service layer.
 *
 * Two clients, two trust levels:
 *  - {@link getUserClient}: RLS-scoped to a caller's JWT. This is the DEFAULT for service queries —
 *    the user's own row-level policies apply, exactly as `SYSTEM_ARCHITECTURE.md` §RLS mandates.
 *  - {@link getServiceClient}: the service-role key, which BYPASSES RLS. Reserved for narrow,
 *    audited administrative reads/writes (e.g. reconciling a verification flag). Never expose it to
 *    the client and never use it to sidestep a policy that should apply to the user.
 *
 * Clients are created on demand (never at import) so a missing/partial environment can't crash app
 * boot — callers gate on {@link isSupabaseConfigured} first.
 */

/** True when the minimum Supabase configuration (URL + anon key) is present. */
export function isSupabaseConfigured(): boolean {
	const env = serverEnv();
	return !!env.supabaseUrl && !!env.supabaseAnonKey;
}

/** True when LIVE backend behaviour is enabled AND Supabase is configured. */
export function isAuthBackendLive(): boolean {
	return serverEnv().authBackendLive && isSupabaseConfigured();
}

/** True when LIVE discovery-backend behaviour is enabled AND Supabase is configured. */
export function isExploreBackendLive(): boolean {
	return serverEnv().exploreBackendLive && isSupabaseConfigured();
}

/** True when LIVE newsletter-backend behaviour is enabled AND Supabase is configured. */
export function isNewsletterBackendLive(): boolean {
	return serverEnv().newsletterBackendLive && isSupabaseConfigured();
}

/** True when LIVE projects-backend behaviour is enabled AND Supabase is configured. */
export function isProjectsBackendLive(): boolean {
	return serverEnv().projectsBackendLive && isSupabaseConfigured();
}

/** True when LIVE profile-backend behaviour is enabled AND Supabase is configured. */
export function isProfileBackendLive(): boolean {
	return serverEnv().profileBackendLive && isSupabaseConfigured();
}

/** True when LIVE messaging-backend behaviour is enabled AND Supabase is configured. */
export function isMessagingBackendLive(): boolean {
	return serverEnv().messagingBackendLive && isSupabaseConfigured();
}

/** True when LIVE logging-backend behaviour is enabled AND Supabase is configured. */
export function isLoggingBackendLive(): boolean {
	return serverEnv().loggingBackendLive && isSupabaseConfigured();
}

/**
 * An RLS-scoped client bound to the caller's access token. Every query runs as that user, so their
 * policies decide what they can see/do. Pass the JWT lifted from the session cookie.
 */
export function getUserClient(accessToken: string): SupabaseClient {
	const env = serverEnv();
	if (!env.supabaseUrl || !env.supabaseAnonKey) {
		throw new Error("Supabase is not configured (SUPABASE_URL / SUPABASE_ANON_KEY).");
	}
	return createClient(env.supabaseUrl, env.supabaseAnonKey, {
		global: { headers: { Authorization: `Bearer ${accessToken}` } },
		auth: { persistSession: false, autoRefreshToken: false },
	});
}

/**
 * The RLS-bypassing service-role client. Use sparingly and only for operations that are legitimately
 * administrative; prefer {@link getUserClient} everywhere else.
 */
export function getServiceClient(): SupabaseClient {
	const env = serverEnv();
	if (!env.supabaseUrl || !env.supabaseServiceRoleKey) {
		throw new Error("Supabase service role is not configured (SUPABASE_URL / service-role key).");
	}
	return createClient(env.supabaseUrl, env.supabaseServiceRoleKey, {
		auth: { persistSession: false, autoRefreshToken: false },
	});
}

/**
 * A stateless anon-key client for public GoTrue operations (password grant, `verifyOtp`, recovery
 * email, resend). No session is persisted server-side — the caller lifts the returned tokens onto
 * HttpOnly cookies itself.
 */
export function getAnonClient(): SupabaseClient {
	const env = serverEnv();
	if (!env.supabaseUrl || !env.supabaseAnonKey) {
		throw new Error("Supabase is not configured (SUPABASE_URL / SUPABASE_ANON_KEY).");
	}
	return createClient(env.supabaseUrl, env.supabaseAnonKey, {
		auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
	});
}

/**
 * CookieStore — a minimal `SupportedStorage` adapter backed by a request's cookies, used to carry
 * the **PKCE code-verifier** across the OAuth round-trip (it's written on the start request, read on
 * the callback). It records every mutation so the route can serialise exactly the touched keys back
 * as `Set-Cookie`s. Only the code-verifier lives here; the session itself is minted as our canonical
 * `sb-access-token` cookies from the exchanged tokens.
 */
export class CookieStore {
	readonly isServer = true;
	#map = new Map<string, string>();
	#touched = new Set<string>();

	constructor(initial: Record<string, string> = {}) {
		for (const [key, value] of Object.entries(initial)) this.#map.set(key, value);
	}

	getItem(key: string): string | null {
		return this.#map.get(key) ?? null;
	}

	setItem(key: string, value: string): void {
		this.#map.set(key, value);
		this.#touched.add(key);
	}

	removeItem(key: string): void {
		this.#map.delete(key);
		this.#touched.add(key);
	}

	/** The touched keys and their final state (`null` ⇒ removed) — for building `Set-Cookie`s. */
	diff(): Array<{ key: string; value: string | null }> {
		return [...this.#touched].map((key) => ({ key, value: this.#map.get(key) ?? null }));
	}
}

/**
 * A PKCE-flow anon client whose auth storage is a {@link CookieStore}, so the code-verifier survives
 * the Google OAuth start→callback round-trip. `detectSessionInUrl` is off (we exchange explicitly).
 */
export function getOAuthClient(store: CookieStore): SupabaseClient {
	const env = serverEnv();
	if (!env.supabaseUrl || !env.supabaseAnonKey) {
		throw new Error("Supabase is not configured (SUPABASE_URL / SUPABASE_ANON_KEY).");
	}
	return createClient(env.supabaseUrl, env.supabaseAnonKey, {
		auth: {
			flowType: "pkce",
			detectSessionInUrl: false,
			persistSession: true,
			autoRefreshToken: false,
			storage: store,
		},
	});
}
