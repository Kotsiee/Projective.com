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
	 * The MASTER mock switch, and the only flag that can override every other gate.
	 *
	 * `true` forces every domain to its fixture path regardless of that domain's own
	 * `*_BACKEND_LIVE` value. `false` — the default — changes nothing: each domain follows its own
	 * gate exactly as before, so an environment that never sets this behaves identically to one that
	 * predates it.
	 *
	 * The direction is deliberate and one-way. It can only ever turn a database read OFF, never on.
	 * A switch that could force a domain live would let one variable enable a half-wired mutation
	 * against a real project, which is the exact failure the per-domain gates exist to prevent — so
	 * this composes with them by AND, never by OR.
	 *
	 * Read from `USE_MOCKS`, or `VITE_USE_MOCKS` as an alias. The canonical name carries no prefix
	 * because it is resolved SERVER-side: islands never read the environment (root CLAUDE.md §2), and
	 * the fixture-vs-database decision is made in the fat service layer, so a client-exposed
	 * `VITE_`/`NEXT_PUBLIC_` variable would advertise a choice the browser does not make. The alias is
	 * accepted so a `VITE_USE_MOCKS` already set in a shell or CI job is honoured rather than silently
	 * ignored.
	 */
	useMocks: boolean;
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
	/**
	 * Master switch for LIVE workspace-backend behaviour. Defaults **off**: {@link WorkspaceBackendService}
	 * answers the `/teams` + `/businesses` reads from deterministic fixtures and mutates an in-module
	 * session store (create · invite · roles · membership · payout split · spend governance) until the
	 * live reads are wired, then flip per environment.
	 *
	 * The live path reads the **existing** `org.teams` / `org.business_profiles` / `org.*_members` /
	 * `org.*_roles` tables — the workspace projections are a read+write view over schema that already
	 * exists, so **no migration accompanies this surface**. Like the catalogue and finance gates it
	 * defaults off because the surface writes: it governs money policy (a team's payout split, a
	 * business's spend envelopes) and authority (roles and per-member permission overrides), so a
	 * half-wired mutation must not be able to fire against a real project.
	 */
	workspaceBackendLive: boolean;
	/**
	 * Master switch for LIVE files-backend behaviour. Defaults **off**: {@link FilesBackendService}
	 * answers the `/files` asset hub from deterministic fixtures and mutates an in-module session store
	 * (upload · rename · move · delete · share · visibility) until the RLS-scoped `files.items` /
	 * `files.folders` / `files.share_links` / `files.download_events` tables and the Supabase Storage
	 * signed-URL handshake are wired, then flip per environment.
	 *
	 * Like the catalogue and finance gates it defaults off because the surface writes — and it writes
	 * two things a half-wired mutation must never touch by accident: **stored bytes** (a signed upload
	 * ticket authorises a real object write) and **reach** (a share link is a bearer capability that
	 * cannot be un-forwarded once it leaks).
	 */
	filesBackendLive: boolean;
	/**
	 * Master switch for LIVE integrations-backend behaviour. Defaults **off**:
	 * {@link IntegrationsBackendService} answers the connector catalogue, a user's connections and a
	 * drive browse from deterministic fixtures until the OAuth consent handshake, the KMS-enveloped
	 * `integrations.connection_secrets` vault and the per-provider storage adapters are wired, then flip
	 * per environment.
	 *
	 * Separate from {@link filesBackendLive} on purpose: the two surfaces share a screen but not a trust
	 * model. A live files backend touches only the platform's own storage under the caller's RLS, while
	 * a live integrations backend acts at a THIRD party with a stored credential — so a single flag
	 * would make enabling the hub silently enable outbound calls carrying someone else's token.
	 */
	integrationsBackendLive: boolean;
}

/** Resolve the current server environment from the canonical Environment Variable Contract names. */
export function serverEnv(): ServerEnv {
	return {
		appEnv: firstEnv("DENO_ENV") ?? "development",
		appUrl: firstEnv("APP_URL") ?? "http://localhost:3000",
		supabaseUrl: firstEnv("SUPABASE_URL"),
		supabaseAnonKey: firstEnv("SUPABASE_ANON_KEY"),
		supabaseServiceRoleKey: firstEnv("SUPABASE_SERVICE_ROLE_KEY"),
		useMocks: (firstEnv("USE_MOCKS", "VITE_USE_MOCKS") ?? "false").toLowerCase() === "true",
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
		workspaceBackendLive: (firstEnv("WORKSPACE_BACKEND_LIVE") ?? "false").toLowerCase() === "true",
		filesBackendLive: (firstEnv("FILES_BACKEND_LIVE") ?? "false").toLowerCase() === "true",
		integrationsBackendLive: (firstEnv("INTEGRATIONS_BACKEND_LIVE") ?? "false").toLowerCase() ===
			"true",
	};
}
