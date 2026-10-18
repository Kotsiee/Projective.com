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
	/**
	 * The Supabase origin a BROWSER reaches — the host every public storage URL is built on.
	 *
	 * Usually identical to {@link supabaseUrl} and defaulted to it, but a distinct fact: the server may
	 * reach the project over an address the browser cannot use (a container hostname, an internal
	 * load balancer), and on a local stack `127.0.0.1` and `localhost` are not interchangeable for
	 * every browser and web filter. A URL built on the server's address would render as a broken image
	 * for exactly the reader who can least diagnose why. Read from `SUPABASE_PUBLIC_URL`.
	 */
	supabasePublicUrl: string | undefined;
	/** Supabase anon (publishable) key — RLS-scoped, used with a user's JWT. */
	supabaseAnonKey: string | undefined;
	/** Supabase service-role key — bypasses RLS; server-only, never sent to the client. */
	supabaseServiceRoleKey: string | undefined;
	/**
	 * The project's legacy HS256 JWT secret, from `SUPABASE_JWT_SECRET` — server-only. Verifies an
	 * access token signed `HS256`; a project on asymmetric signing keys verifies against its JWKS and
	 * needs none (`core/access-token.ts`). The `XXXX-XXXX` placeholder counts as absent.
	 */
	supabaseJwtSecret: string | undefined;
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
	 * validates opt-ins and answers the subscribe plan without writing; on, it calls
	 * `community.subscribe_newsletter` with the service role (Decision #274). The email-provider sync
	 * is still to come, so a live subscription is stored but not yet sent anything.
	 */
	newsletterBackendLive: boolean;
	/**
	 * Master switch for LIVE editorial-backend behaviour, from `EDITORIAL_BACKEND_LIVE` (Decision #274).
	 * Defaults **off**: the help centre, the changelog and Projective's articles answer from their
	 * Zod-validated content sources (`services/editorial/content/*`) through the same row parse and
	 * mapping the live read uses; on, they read the `editorial.*` tables through the anon client. Read
	 * it through `isEditorialBackendLive()` (`core/supabase.ts`).
	 */
	editorialBackendLive: boolean;
	/**
	 * Master switch for LIVE community-backend behaviour, from `COMMUNITY_BACKEND_LIVE` (Decision #274).
	 * Defaults **off**: the help centre's helpfulness votes and the feedback board answer from fixtures
	 * and write nothing; on, they read and write `community.*` through its definer doors. A write
	 * surface open to signed-out visitors, so like the catalogue gate it protects a half-wired mutation
	 * from firing against a real project. The newsletter keeps its own `NEWSLETTER_BACKEND_LIVE`.
	 */
	communityBackendLive: boolean;
	/**
	 * Master switch for LIVE `/contact` intake, from `CONTACT_BACKEND_LIVE` (Decision #276). Defaults
	 * **off**: in development the intake validates, rate-limits and answers a receipt without storing
	 * anything (attachments are checked against their declaration, not uploaded); in production it
	 * refuses with a 503 rather than acknowledge a message nobody will read. On, requests are written
	 * through `ops.submit_contact_request` and attachments go through the quarantine pipeline into the
	 * `contact` bucket.
	 */
	contactBackendLive: boolean;
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
	 * acknowledges the production `error`/`warn`, web-vitals and server-error ingest with a console
	 * echo; on, it inserts into `ops.log_entries`. Orthogonal to `DENO_ENV` — this gates
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
	/**
	 * Whether discovery ranks with voyage-4 vectors (Decision #179), from `EMBEDDINGS_ENABLED`.
	 * Defaults **off**: search and the "Similar" rails keep their heuristic order and nothing calls
	 * Voyage. In development the Dev Context Switcher's `pj.dev.embeddings` cookie may override it per
	 * request; production never reads the cookie. Read it through `isEmbeddingsLive`
	 * (`core/supabase.ts`), which also requires the key, Supabase and no `USE_MOCKS`.
	 */
	embeddingsEnabled: boolean;
	/**
	 * The Voyage AI key, from `VOYAGE_API_KEY`. Server-only: it is sent only as the `Authorization`
	 * header of `POST {host}/v1/embeddings` and is never logged, echoed in an error or sent to a client.
	 * The `XXXX-XXXX` placeholder counts as absent. A MongoDB Atlas model API key is answered by
	 * `https://ai.mongodb.com`; a Voyage platform key (`pa-…`) only by `https://api.voyageai.com` — the
	 * client picks the host from the key unless {@link voyageApiBase} names one.
	 */
	voyageApiKey: string | undefined;
	/**
	 * Optional explicit embeddings host (`https://ai.mongodb.com`, `https://api.voyageai.com`, or a mock),
	 * from `VOYAGE_API_BASE`. Absent: chosen from the key's kind (`services/search/voyage-client.ts`).
	 */
	voyageApiBase: string | undefined;
	/**
	 * The Stripe secret — or, preferably, RESTRICTED — API key (`sk_…` / `rk_…`), from
	 * `STRIPE_SECRET_KEY`. Server-only: it can move money, so it is never logged, never echoed in an
	 * error and never reaches an island.
	 *
	 * Read raw here and VALIDATED in `core/stripe.ts`, which treats anything that is not shaped like a
	 * real key — the `.env.example` placeholder `XXXX-XXXX` included — as absent. A placeholder that
	 * counted as configured would turn "payments are not connected here" into a stream of
	 * authentication failures at Stripe.
	 */
	stripeSecretKey: string | undefined;
	/**
	 * The signing secret of the Stripe webhook endpoint (`whsec_…`), from `STRIPE_WEBHOOK_SECRET`.
	 * Without it no inbound event can be verified, so none is processed.
	 */
	stripeWebhookSecret: string | undefined;
	/**
	 * The Stripe publishable key (`pk_…`), from the documented contract name
	 * `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` (§8 row 11: canonical names only, no aliases).
	 *
	 * Publishable by design — it identifies the account to Stripe.js and can move nothing — but it still
	 * reaches the browser only through a server response (islands never read the environment, root
	 * CLAUDE.md §2), paired with the client secret of the object it is meant to confirm.
	 */
	stripePublishableKey: string | undefined;
	/**
	 * DEVELOPMENT-ONLY override of the Stripe API origin, from `STRIPE_API_BASE` — e.g.
	 * `http://localhost:12111` for `stripe-mock`, which answers every v1 endpoint and validates each
	 * request against Stripe's OpenAPI spec, so the full payment flow runs locally without an account.
	 *
	 * Honoured only for a TEST-mode key outside `DENO_ENV=production` (`core/stripe.ts`): a live key
	 * pointed at a mock would record charges that never happened.
	 */
	stripeApiBase: string | undefined;
	/**
	 * The signing secret of the SECOND Stripe endpoint, `POST {APP_URL}/api/finance/webhooks/stripe-v2`,
	 * from `STRIPE_THIN_WEBHOOK_SECRET` (`whsec_…`). Accounts v2 publishes its events as THIN events on
	 * an event destination of their own — Stripe will not put them on the snapshot endpoint — so they
	 * carry their own secret. Absent: the v2 endpoint answers 503 and v1 `account.updated` + the
	 * onboarding return URL remain the only status sync.
	 */
	stripeThinWebhookSecret: string | undefined;
	/**
	 * The signing secret of the platform's CONNECT event destination, from
	 * `STRIPE_CONNECT_WEBHOOK_SECRET` (`whsec_…`). Events that happen ON a connected account — its
	 * `payout.paid` / `payout.failed` and its `account.updated` — are delivered to a Connect
	 * destination with its own secret; it may point at the same `/api/finance/webhooks/stripe` URL,
	 * which verifies against either secret (Decision #202). Absent: those events are refused as unsigned.
	 */
	stripeConnectWebhookSecret: string | undefined;
	/**
	 * The bearer token the scheduler presents to `POST /api/finance/cron/deposits` and
	 * `POST /api/finance/cron/payouts`, from `FINANCE_CRON_SECRET`. The routes charge saved cards and
	 * send transfers, so they answer 404 (not 401) to anything else — including every request while this
	 * is unset or shorter than 32 characters.
	 */
	financeCronSecret: string | undefined;
	/**
	 * The bearer token the scheduler presents to `POST /api/user/cron/erasures`, from
	 * `ACCOUNT_CRON_SECRET`. The route runs the account and freelancer-profile erasures that have come
	 * due, so like the deposits route it answers 404 to anything else — including every request while
	 * this is unset or shorter than 32 characters.
	 */
	accountCronSecret: string | undefined;
	/**
	 * The bearer token the scheduler presents to `POST /api/scheduling/cron/horizon`, from
	 * `SCHEDULING_CRON_SECRET`. The route recompiles availability presets running short of their
	 * occurrence horizon, and like the other cron routes answers 404 to anything else — including every
	 * request while this is unset or shorter than 32 characters.
	 */
	schedulingCronSecret: string | undefined;
	/**
	 * The Google Safe Browsing (v4 Lookup) API key a link's reputation is checked against, from
	 * `LINK_SAFETY_API_KEY`. Server-only. The `XXXX-XXXX` placeholder counts as absent
	 * (`files/link-reputation.ts`), and an absent key skips the reputation check rather than failing it.
	 */
	linkSafetyApiKey: string | undefined;
	/**
	 * The Secret Token of the Zoom app's Event Subscription, from `ZOOM_WEBHOOK_SECRET` (Decision #171).
	 * Server-only. It signs every `POST {APP_URL}/api/sessions/webhooks/zoom` delivery (`x-zm-signature`)
	 * and answers Zoom's endpoint validation challenge; while it is unset or the `XXXX-XXXX`
	 * placeholder, the route refuses every delivery rather than trusting an unsigned one.
	 */
	zoomWebhookSecret: string | undefined;
}

/** Resolve the current server environment from the canonical Environment Variable Contract names. */
export function serverEnv(): ServerEnv {
	return {
		appEnv: firstEnv("DENO_ENV") ?? "development",
		appUrl: firstEnv("APP_URL") ?? `http://localhost:${firstEnv("PORT") ?? "3000"}`,
		supabaseUrl: firstEnv("SUPABASE_URL"),
		supabasePublicUrl: firstEnv("SUPABASE_PUBLIC_URL", "SUPABASE_URL"),
		supabaseAnonKey: firstEnv("SUPABASE_ANON_KEY"),
		supabaseServiceRoleKey: firstEnv("SUPABASE_SERVICE_ROLE_KEY"),
		supabaseJwtSecret: firstEnv("SUPABASE_JWT_SECRET"),
		useMocks: (firstEnv("USE_MOCKS", "VITE_USE_MOCKS") ?? "false").toLowerCase() === "true",
		authBackendLive: (firstEnv("AUTH_BACKEND_LIVE") ?? "false").toLowerCase() === "true",
		exploreBackendLive: (firstEnv("EXPLORE_BACKEND_LIVE") ?? "false").toLowerCase() === "true",
		newsletterBackendLive: (firstEnv("NEWSLETTER_BACKEND_LIVE") ?? "false").toLowerCase() ===
			"true",
		editorialBackendLive: (firstEnv("EDITORIAL_BACKEND_LIVE") ?? "false").toLowerCase() === "true",
		communityBackendLive: (firstEnv("COMMUNITY_BACKEND_LIVE") ?? "false").toLowerCase() === "true",
		contactBackendLive: (firstEnv("CONTACT_BACKEND_LIVE") ?? "false").toLowerCase() === "true",
		projectsBackendLive: (firstEnv("PROJECTS_BACKEND_LIVE") ?? "false").toLowerCase() === "true",
		profileBackendLive: (firstEnv("PROFILE_BACKEND_LIVE") ?? "false").toLowerCase() === "true",
		messagingBackendLive: (firstEnv("MESSAGING_BACKEND_LIVE") ?? "false").toLowerCase() === "true",
		catalogueBackendLive: (firstEnv("CATALOGUE_BACKEND_LIVE") ?? "false").toLowerCase() === "true",
		loggingBackendLive: (firstEnv("LOGGING_BACKEND_LIVE") ?? "false").toLowerCase() === "true",
		financeBackendLive: (firstEnv("FINANCE_BACKEND_LIVE") ?? "false").toLowerCase() === "true",
		filesBackendLive: (firstEnv("FILES_BACKEND_LIVE") ?? "false").toLowerCase() === "true",
		integrationsBackendLive: (firstEnv("INTEGRATIONS_BACKEND_LIVE") ?? "false").toLowerCase() ===
			"true",
		embeddingsEnabled: (firstEnv("EMBEDDINGS_ENABLED") ?? "false").toLowerCase() === "true",
		voyageApiKey: firstEnv("VOYAGE_API_KEY"),
		voyageApiBase: firstEnv("VOYAGE_API_BASE"),
		stripeSecretKey: firstEnv("STRIPE_SECRET_KEY"),
		stripeWebhookSecret: firstEnv("STRIPE_WEBHOOK_SECRET"),
		stripePublishableKey: firstEnv("NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY"),
		stripeApiBase: firstEnv("STRIPE_API_BASE"),
		stripeThinWebhookSecret: firstEnv("STRIPE_THIN_WEBHOOK_SECRET"),
		stripeConnectWebhookSecret: firstEnv("STRIPE_CONNECT_WEBHOOK_SECRET"),
		financeCronSecret: firstEnv("FINANCE_CRON_SECRET"),
		accountCronSecret: firstEnv("ACCOUNT_CRON_SECRET"),
		schedulingCronSecret: firstEnv("SCHEDULING_CRON_SECRET"),
		linkSafetyApiKey: firstEnv("LINK_SAFETY_API_KEY"),
		zoomWebhookSecret: firstEnv("ZOOM_WEBHOOK_SECRET"),
	};
}
