import { AsyncLocalStorage } from "node:async_hooks";
import { createClient, type SupabaseClient } from "supabaseClient";
import type { EmbeddingsStatus } from "@projective/types/explore";
import { serverEnv } from "./env.ts";
import { hasVoyageKey, readEmbeddingsOverride, resolveEmbeddingsGate } from "./embeddings-gate.ts";

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
 *
 * Under `USE_MOCKS` no factory hands out a client: each throws {@link MocksForcedError}. That is what
 * makes "`dev:mock` reaches no database" true of every service, gated or not. A service with a
 * fixture road never gets here (its `isXBackendLive()` is already false); one without maps the error
 * to its own 503 (`isMocksForced`, {@link mocksForcedResult}).
 */

// #region Mocks forced
/** The sentence a live-only service answers under `USE_MOCKS`, unless it has a better one of its own. */
export const MOCKS_FORCED_MESSAGE = "This isn't available in this environment.";

/**
 * Thrown by every client factory (and the raw storage fetch) while `USE_MOCKS` is on. A typed error,
 * not a configuration failure: the environment chose fixtures, so a live-only service answers 503
 * "isn't available in this environment" instead of a 500 or a fixture `ok`.
 */
export class MocksForcedError extends Error {
	/** Stable tag, so the check survives a second copy of this module in a bundle. */
	readonly code = "MOCKS_FORCED";
	/** The status a service should answer with. */
	readonly status = 503;

	constructor(readonly factory: string) {
		super(`USE_MOCKS is on: ${factory} hands out no database client.`);
		this.name = "MocksForcedError";
	}
}

/** True for a {@link MocksForcedError}, from this module or a duplicate of it. */
export function isMocksForced(error: unknown): error is MocksForcedError {
	return error instanceof MocksForcedError ||
		(error instanceof Error && (error as { code?: unknown }).code === "MOCKS_FORCED");
}

/**
 * The 503 a live-only service answers when `error` is the mocks refusal, else `null`. Shaped like a
 * failed `ServiceResult` without importing it (core does not depend on the service layer).
 */
export function mocksForcedResult(
	error: unknown,
	message: string = MOCKS_FORCED_MESSAGE,
): { ok: false; status: 503; message: string } | null {
	return isMocksForced(error) ? { ok: false, status: 503, message } : null;
}

/** Throws {@link MocksForcedError} while `USE_MOCKS` is on; every client factory starts here. */
export function assertDatabaseAllowed(factory: string): void {
	if (useMocks()) throw new MocksForcedError(factory);
}
// #endregion

/** True when the minimum Supabase configuration (URL + anon key) is present. */
export function isSupabaseConfigured(): boolean {
	const env = serverEnv();
	return !!env.supabaseUrl && !!env.supabaseAnonKey;
}

/**
 * True when the MASTER mock switch is on (`USE_MOCKS` / `VITE_USE_MOCKS`).
 *
 * It means no database. Every `isXBackendLive()` predicate below is ANDed with `!useMocks()`, so a
 * gated domain takes its fixture road, and every client factory refuses with {@link MocksForcedError},
 * so an always-live service answers its own 503 instead of reaching Supabase. One variable runs the
 * whole platform with the database stopped: the control a developer, a demo or an offline CI run wants.
 *
 * It composes by AND rather than OR on purpose: this can only ever turn a database path OFF. Making
 * it able to force one ON would mean a single misconfigured variable could fire a half-wired money
 * or storage mutation at a real project, which is precisely what the per-domain gates were
 * introduced to prevent.
 *
 * Default `false` — so an environment that has never heard of this flag behaves exactly as it did
 * before it existed.
 */
export function useMocks(): boolean {
	return serverEnv().useMocks;
}

/** True when LIVE backend behaviour is enabled AND Supabase is configured. */
export function isAuthBackendLive(): boolean {
	return !useMocks() && serverEnv().authBackendLive && isSupabaseConfigured();
}

/** True when LIVE discovery-backend behaviour is enabled AND Supabase is configured. */
export function isExploreBackendLive(): boolean {
	return !useMocks() && serverEnv().exploreBackendLive && isSupabaseConfigured();
}

/** True when LIVE newsletter-backend behaviour is enabled AND Supabase is configured. */
export function isNewsletterBackendLive(): boolean {
	return !useMocks() && serverEnv().newsletterBackendLive && isSupabaseConfigured();
}

/**
 * True when LIVE editorial-backend behaviour is enabled AND Supabase is configured (Decision #274).
 * Off, the editorial surfaces serve their content sources through the same row parse and mapping.
 */
export function isEditorialBackendLive(): boolean {
	return !useMocks() && serverEnv().editorialBackendLive && isSupabaseConfigured();
}

/** True when LIVE community-backend behaviour is enabled AND Supabase is configured (Decision #274). */
export function isCommunityBackendLive(): boolean {
	return !useMocks() && serverEnv().communityBackendLive && isSupabaseConfigured();
}

/** True when LIVE `/contact` intake is enabled AND Supabase is configured (Decision #276). */
export function isContactBackendLive(): boolean {
	return !useMocks() && serverEnv().contactBackendLive && isSupabaseConfigured();
}

/** True when LIVE projects-backend behaviour is enabled AND Supabase is configured. */
export function isProjectsBackendLive(): boolean {
	return !useMocks() && serverEnv().projectsBackendLive && isSupabaseConfigured();
}

/** True when LIVE messaging-backend behaviour is enabled AND Supabase is configured. */
export function isMessagingBackendLive(): boolean {
	return !useMocks() && serverEnv().messagingBackendLive && isSupabaseConfigured();
}

/** True when LIVE catalogue-backend behaviour is enabled AND Supabase is configured. */
export function isCatalogueBackendLive(): boolean {
	return !useMocks() && serverEnv().catalogueBackendLive && isSupabaseConfigured();
}

/** True when LIVE logging-backend behaviour is enabled AND Supabase is configured. */
export function isLoggingBackendLive(): boolean {
	return !useMocks() && serverEnv().loggingBackendLive && isSupabaseConfigured();
}

/** True when LIVE finance-backend behaviour is enabled AND Supabase is configured. */
export function isFinanceBackendLive(): boolean {
	return !useMocks() && serverEnv().financeBackendLive && isSupabaseConfigured();
}

/** True when LIVE files/asset-hub backend behaviour is enabled AND Supabase is configured. */
export function isFilesBackendLive(): boolean {
	return !useMocks() && serverEnv().filesBackendLive && isSupabaseConfigured();
}

/**
 * True when LIVE integrations-backend behaviour is enabled AND Supabase is configured.
 *
 * Supabase configuration is part of the predicate even though the outbound calls go to a third party:
 * every connector read starts by resolving the caller's `integrations.user_connections` row and its
 * enveloped secret, so an unconfigured project cannot reach a provider regardless of the flag.
 */
export function isIntegrationsBackendLive(): boolean {
	return !useMocks() && serverEnv().integrationsBackendLive && isSupabaseConfigured();
}

/**
 * True when discovery may rank with voyage-4 vectors for this request (Decision #179): not mocked,
 * Supabase configured, `VOYAGE_API_KEY` present, and the effective setting on.
 *
 * The setting is `EMBEDDINGS_ENABLED`, unless `req` carries the Dev Context Switcher's
 * `pj.dev.embeddings` cookie (`on` | `off`). The cookie counts only under `DENO_ENV=development`, and
 * the routes pass `req` only from a development build (`IS_DEV`, like `pj.dev.landing`), so production
 * ignores it twice over. An override can turn the switch on, but never without the key. Callers with
 * no request — the post-commit re-embed, the backfill — get the environment's answer.
 */
export function isEmbeddingsLive(req?: Request): boolean {
	return embeddingsStatus(req).ranking === "semantic";
}

/** The same decision as {@link isEmbeddingsLive}, with every input that made it (the switcher's status line). */
export function embeddingsStatus(req?: Request): EmbeddingsStatus {
	const env = serverEnv();
	return resolveEmbeddingsGate({
		useMocks: env.useMocks,
		supabaseConfigured: isSupabaseConfigured(),
		keyPresent: hasVoyageKey(env.voyageApiKey),
		envEnabled: env.embeddingsEnabled,
		development: env.appEnv === "development",
		override: req ? readEmbeddingsOverride(req.headers.get("cookie")) : null,
	});
}

/**
 * An RLS-scoped client bound to the caller's access token. Every query runs as that user, so their
 * policies decide what they can see/do. Pass the JWT lifted from the session cookie. `headers` adds
 * request headers PostgREST exposes to SQL as `request.headers` (a development override's only road).
 */
export function getUserClient(
	accessToken: string,
	headers: Record<string, string> = {},
): SupabaseClient {
	assertDatabaseAllowed("getUserClient");
	const env = serverEnv();
	if (!env.supabaseUrl || !env.supabaseAnonKey) {
		throw new Error("Supabase is not configured (SUPABASE_URL / SUPABASE_ANON_KEY).");
	}
	return createClient(env.supabaseUrl, env.supabaseAnonKey, {
		global: { headers: { ...headers, Authorization: `Bearer ${accessToken}` } },
		auth: { persistSession: false, autoRefreshToken: false },
	});
}

/**
 * The RLS-bypassing service-role client. Use sparingly and only for operations that are legitimately
 * administrative; prefer {@link getUserClient} everywhere else.
 */
export function getServiceClient(): SupabaseClient {
	assertDatabaseAllowed("getServiceClient");
	const env = serverEnv();
	if (!env.supabaseUrl || !env.supabaseServiceRoleKey) {
		throw new Error("Supabase service role is not configured (SUPABASE_URL / service-role key).");
	}
	return createClient(env.supabaseUrl, env.supabaseServiceRoleKey, {
		auth: { persistSession: false, autoRefreshToken: false },
	});
}

// #region Client address
/**
 * The address of the client a request acts for, carried across the request's async subtree so the
 * anon and OAuth clients can forward it to GoTrue as `X-Forwarded-For` (IW-H3). Without it GoTrue's
 * per-IP limits count the app server's address: one bucket for the whole platform. The address is
 * the one the app's own limiter keys on (`apps/web/utils/client-key.ts`, never a client-written
 * header), opened by the `/api/auth/*` middleware.
 */
const clientAddressScope = new AsyncLocalStorage<string>();

/** Run `fn` with `address` as the client address forwarded to GoTrue. */
export function runWithClientAddress<T>(address: string, fn: () => T): T {
	return clientAddressScope.run(address, fn);
}

/** The forwarded-address header for the current request, or none outside a scope. */
export function clientAddressHeaders(): Record<string, string> {
	const address = clientAddressScope.getStore();
	return address ? { "X-Forwarded-For": address } : {};
}
// #endregion

/**
 * A stateless anon-key client for public GoTrue operations (password grant, `verifyOtp`, recovery
 * email, resend). No session is persisted server-side — the caller lifts the returned tokens onto
 * HttpOnly cookies itself. Inside {@link runWithClientAddress} it forwards the client's address.
 */
export function getAnonClient(): SupabaseClient {
	assertDatabaseAllowed("getAnonClient");
	const env = serverEnv();
	if (!env.supabaseUrl || !env.supabaseAnonKey) {
		throw new Error("Supabase is not configured (SUPABASE_URL / SUPABASE_ANON_KEY).");
	}
	return createClient(env.supabaseUrl, env.supabaseAnonKey, {
		global: { headers: clientAddressHeaders() },
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
	assertDatabaseAllowed("getOAuthClient");
	const env = serverEnv();
	if (!env.supabaseUrl || !env.supabaseAnonKey) {
		throw new Error("Supabase is not configured (SUPABASE_URL / SUPABASE_ANON_KEY).");
	}
	return createClient(env.supabaseUrl, env.supabaseAnonKey, {
		global: { headers: clientAddressHeaders() },
		auth: {
			flowType: "pkce",
			detectSessionInUrl: false,
			persistSession: true,
			autoRefreshToken: false,
			storage: store,
		},
	});
}
