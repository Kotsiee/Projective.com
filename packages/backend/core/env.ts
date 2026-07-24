/**
 * env.ts — the single, typed reader for the server-side environment contract.
 *
 * Only the FAT service layer (this package) and Fresh route/middleware code read the environment;
 * islands never do. Values are read lazily (`Deno.env.get`) so importing this module has no side
 * effects and never throws at load — a misconfigured environment degrades a feature to its stub path
 * rather than crashing the whole app (see {@link AuthBackendService}).
 *
 * Env-name contract (root CLAUDE.md §8 row 11, reconciled): the canonical names from the documented
 * Environment Variable Contract (`SYSTEM_ARCHITECTURE.md`) are the single source of truth —
 * `DENO_ENV` / `APP_URL` / `SUPABASE_SERVICE_ROLE_KEY` / `GOOGLE_CLIENT_SECRET`. The former
 * `.env.development` aliases (`APP_ENV` / `URL` / `SB_SERVICE_ROLE_KEY` / `GOOGLE_SECRET`) were
 * renamed to match, so this reader reads each canonical name directly — no fallback aliases remain.
 */

/** Read the first environment variable that is set among `names`, else `undefined`. */
function firstEnv(...names: string[]): string | undefined {
	for (const name of names) {
		try {
			const value = Deno.env.get(name);
			if (value) return value;
		} catch {
			// --allow-env not granted (e.g. a restricted context) — treat as unset.
			return undefined;
		}
	}
	return undefined;
}

/** The resolved server environment. Read via {@link serverEnv}. */
export interface ServerEnv {
	/** `development` | `production` — drives log verbosity and safety rails. */
	appEnv: string;
	/** Public base URL of the app (for building absolute links in emails, OAuth callbacks). */
	appUrl: string;
	/** Supabase project URL. */
	supabaseUrl: string | undefined;
	/** Supabase anon (publishable) key — RLS-scoped, used with a user's JWT. */
	supabaseAnonKey: string | undefined;
	/** Supabase service-role key — bypasses RLS; server-only, never sent to the client. */
	supabaseServiceRoleKey: string | undefined;
	/**
	 * Master switch for LIVE auth-backend behaviour. Defaults **off**: the fat services run their
	 * safe stub paths until the real Supabase/GoTrue calls are implemented and verified, then flip
	 * this to `true` per environment. Prevents half-wired queries from firing against a real project.
	 */
	authBackendLive: boolean;
	/**
	 * Master switch for LIVE discovery-backend behaviour. Defaults **off**: {@link ExploreBackendService}
	 * answers from in-memory fixtures until the Supabase discovery tables + search embeddings are
	 * implemented and verified, then flip per environment.
	 */
	exploreBackendLive: boolean;
	/**
	 * Master switch for LIVE newsletter-backend behaviour. Defaults **off**: {@link NewsletterBackendService}
	 * accepts opt-ins into a no-op stub until the `newsletter.subscriptions` table + provider sync land,
	 * then flip per environment.
	 */
	newsletterBackendLive: boolean;
	/**
	 * Master switch for LIVE projects-backend behaviour. Defaults **off**: {@link ProjectBackendService}
	 * answers the `/projects` feed from in-memory fixtures until the RLS-scoped `projects.*` + `org.*`
	 * membership reads are implemented and verified, then flip per environment.
	 */
	projectsBackendLive: boolean;
	/**
	 * Master switch for LIVE profile-backend behaviour. Defaults **off**: {@link ProfileBackendService}
	 * answers the `/[handle]` profile from deterministic fixtures until the RLS-scoped `org.users_public`
	 * + profile tables are implemented and verified, then flip per environment.
	 */
	profileBackendLive: boolean;
	/**
	 * Master switch for LIVE messaging-backend behaviour. Defaults **off**: {@link MessagingBackendService}
	 * answers the `/messages` inbox (conversations · settings) from deterministic fixtures until the
	 * RLS-scoped `messages.*` tables (unified with project channels by `chatId`) are implemented and
	 * verified, then flip per environment.
	 */
	messagingBackendLive: boolean;
	/**
	 * Master switch for LIVE catalogue-backend behaviour. Defaults **off**: {@link CatalogueBackendService}
	 * answers the seller `/catalogue` reads from deterministic fixtures and mutates an in-module session
	 * store (create/update/publish) until the RLS-scoped `catalogue.*` tables + mutation policies land,
	 * then flip per environment. This is the first WRITE surface, so the gate protects a half-wired
	 * mutation from firing against a real project.
	 */
	catalogueBackendLive: boolean;
	/**
	 * Master switch for LIVE logging-backend behaviour. Defaults **off**: {@link LogBackendService}
	 * accepts the production `error`/`warn` ingest into a no-op stub (console echo) until the
	 * `logging.entries` table lands, then flip per environment. Orthogonal to `DENO_ENV` — this gates
	 * *persistence*, `appEnv` gates *verbosity*.
	 */
	loggingBackendLive: boolean;
	/**
	 * Master switch for LIVE finance-backend behaviour. Defaults **off**: {@link WalletBackendService}
	 * answers the `/wallet` reads from deterministic fixtures and mutates an in-module session store
	 * (top-up / withdraw / transfer / distribute / …) until the RLS-scoped `finance.*` tables + money
	 * functions are wired, then flip per environment. Like the catalogue write gate, this protects a
	 * half-wired money mutation from firing against a real project — the reason it defaults off even
	 * where other backends are live.
	 */
	financeBackendLive: boolean;
}

/** Resolve the current server environment from the canonical Environment Variable Contract names. */
export function serverEnv(): ServerEnv {
	return {
		appEnv: firstEnv("DENO_ENV") ?? "development",
		appUrl: firstEnv("APP_URL") ?? "http://localhost:3000",
		supabaseUrl: firstEnv("SUPABASE_URL"),
		supabaseAnonKey: firstEnv("SUPABASE_ANON_KEY"),
		supabaseServiceRoleKey: firstEnv("SUPABASE_SERVICE_ROLE_KEY"),
		authBackendLive: (firstEnv("AUTH_BACKEND_LIVE") ?? "false").toLowerCase() === "true",
		exploreBackendLive: (firstEnv("EXPLORE_BACKEND_LIVE") ?? "false").toLowerCase() === "true",
		newsletterBackendLive: (firstEnv("NEWSLETTER_BACKEND_LIVE") ?? "false").toLowerCase() ===
			"true",
		projectsBackendLive: (firstEnv("PROJECTS_BACKEND_LIVE") ?? "false").toLowerCase() === "true",
		profileBackendLive: (firstEnv("PROFILE_BACKEND_LIVE") ?? "false").toLowerCase() === "true",
		messagingBackendLive: (firstEnv("MESSAGING_BACKEND_LIVE") ?? "false").toLowerCase() === "true",
		catalogueBackendLive: (firstEnv("CATALOGUE_BACKEND_LIVE") ?? "false").toLowerCase() === "true",
		loggingBackendLive: (firstEnv("LOGGING_BACKEND_LIVE") ?? "false").toLowerCase() === "true",
		financeBackendLive: (firstEnv("FINANCE_BACKEND_LIVE") ?? "false").toLowerCase() === "true",
	};
}
