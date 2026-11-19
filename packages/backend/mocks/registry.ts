/**
 * registry.ts — where every service domain's data comes from: the gate that governs it (or none),
 * what that gate covers, and what a request gets when it is off.
 *
 * ## What this is for
 *
 * "Is this page reading the database or fixtures, and what would it take to make it real?" should
 * be answerable without opening the service layer. This registry is that answer, one entry per
 * `packages/backend/services/<dir>` that reaches the database. It is DATA, not behaviour: it imports
 * no fixture module, so listing the corpus costs nothing at runtime and adding a row cannot drag a
 * dataset into a bundle. {@link ./mod.ts} re-exports the datasets themselves.
 *
 * ## It describes the code, and a test holds it there
 *
 * `registry.test.ts` lists the service directories, scans each one's sources for a database call and
 * for the `is*BackendLive` predicate it consults, and fails when a directory that reaches the
 * database has no entry, or an entry's `gate` or `liveImplemented` disagrees with the code. It also
 * fails on a dead flag: a `*_BACKEND_LIVE` the server reads that gates nothing, or one `.env.example`
 * offers that no entry uses. Every count about the registry is computed by `describeDataSources()`
 * (`core/data-source.ts`), never written in prose, because a written count goes stale.
 *
 * ## Reading an entry
 *
 *  - `gate` — the flag its code consults, or `null` for an always-live domain (`alwaysLive` says why).
 *  - `gated` — the sub-features the gate covers. A gate rarely covers a whole domain: EXPLORE, CATALOGUE
 *    and FILES each gate a slice, and `ungated` lists what reads the database whatever the gate says.
 *  - `fixtureRoad` — with the gate off, the `gated` sub-features answer fixtures, a stub, or an
 *    acknowledgement that stores nothing, rather than refusing. Under `USE_MOCKS` that road is all a
 *    domain serves: everything else (an always-live domain, every `ungated` sub-feature) answers its
 *    own 503 "isn't available in this environment", because every Supabase client factory refuses.
 *
 * The app-side `apps/web/features/shell/core/nav-fixtures.ts` (the `dev:mock` account facts the
 * navigation shell gates on) is not a service domain and reaches no database, so it is not listed.
 */

/** The environment flag governing one domain's fixture-vs-database choice. */
export type BackendGate =
	| "AUTH_BACKEND_LIVE"
	| "EXPLORE_BACKEND_LIVE"
	| "PROJECTS_BACKEND_LIVE"
	| "MESSAGING_BACKEND_LIVE"
	| "CATALOGUE_BACKEND_LIVE"
	| "NEWSLETTER_BACKEND_LIVE"
	| "FINANCE_BACKEND_LIVE"
	| "FILES_BACKEND_LIVE"
	| "INTEGRATIONS_BACKEND_LIVE"
	| "LOGGING_BACKEND_LIVE"
	| "EDITORIAL_BACKEND_LIVE"
	| "COMMUNITY_BACKEND_LIVE"
	| "CONTACT_BACKEND_LIVE";

/** The service domains, one per `packages/backend/services/<dir>` that reaches the database. */
export type MockDomain =
	| "auth"
	| "booking"
	| "catalogue"
	| "comms"
	| "community"
	| "contact"
	| "context"
	| "editorial"
	| "explore"
	| "files"
	| "finance"
	| "integrations"
	| "legal"
	| "logging"
	| "marketing"
	| "media"
	| "messaging"
	| "newsletter"
	| "ops"
	| "profile"
	| "projects"
	| "quotes"
	| "saved"
	| "scheduling"
	| "search"
	| "sessions"
	| "user"
	| "workspace";

/** One domain of the registry. */
export interface MockDomainInfo {
	/** The domain key, which is its service directory's name. */
	domain: MockDomain;
	/** Human label for tooling and docs. */
	label: string;
	/** The env flag its code consults, or `null`: the domain is always live (see `alwaysLive`). */
	gate: BackendGate | null;
	/** One line on why an ungated domain has no gate. Present exactly when `gate` is `null`. */
	alwaysLive?: string;
	/**
	 * Whether a REAL database path exists in the domain. `false` would mean a gate set to `true`
	 * changes nothing; the contract test holds it to the code.
	 */
	liveImplemented: boolean;
	/** Whether the `gated` sub-features answer something other than a refusal with the gate off. */
	fixtureRoad: boolean;
	/** The sub-features the gate covers. Empty for an always-live domain. */
	gated: readonly string[];
	/** The sub-features that read the database whatever the gate says (503 under `USE_MOCKS`). */
	ungated: readonly string[];
	/** Fixture modules backing the fixture road, relative to `packages/backend/`. */
	modules: readonly string[];
	/** Postgres schemas the live path reads. */
	schemas: readonly string[];
	/** What the domain covers. */
	description: string;
}

/** The registry. Keep entries in directory order; `registry.test.ts` holds each one to its code. */
export const MOCK_REGISTRY: Readonly<Record<MockDomain, MockDomainInfo>> = Object.freeze({
	auth: {
		domain: "auth",
		label: "Authentication & session",
		gate: "AUTH_BACKEND_LIVE",
		liveImplemented: true,
		fixtureRoad: true,
		gated: [
			"sign-in, join, OAuth, verification, refresh and sign-out (off: stub sessions)",
			"connected sign-in identities (IdentitiesBackendService)",
			"access-token verification (off, outside production: presence is trusted)",
		],
		ungated: [],
		modules: [],
		schemas: ["auth", "org", "security"],
		description:
			"GoTrue and the org identity rows. Off, the stub sessions are opaque tokens the dev personas sign in with; production always verifies a token, whatever the gate says.",
	},
	booking: {
		domain: "booking",
		label: "Service booking",
		gate: "PROJECTS_BACKEND_LIVE",
		liveImplemented: true,
		fixtureRoad: true,
		gated: ["the booking draft a stub project reads back (draft store)"],
		ungated: [
			"a listing's booking offer and its call offer",
			"bookable slots, session booking and seat reservation (seats through sessions)",
			"contact actions (discovery call, custom quote) and discovery-call moves",
		],
		modules: ["services/booking/intake-fixtures.ts", "services/projects/draft-store.ts"],
		schemas: ["scheduling", "marketplace", "org"],
		description:
			"The buyer's side of a service listing: what it offers, when it can be booked, and the moves on a discovery call. Reads scheduling.* through the anonymous client and writes through the caller's doors.",
	},
	catalogue: {
		domain: "catalogue",
		label: "Seller catalogue",
		gate: "CATALOGUE_BACKEND_LIVE",
		liveImplemented: true,
		fixtureRoad: true,
		gated: [
			"Analytics overview (CatalogueAnalyticsBackendService)",
			"Clients pipeline, client detail and waitlist (CatalogueClientsBackendService)",
		],
		ungated: [
			"listing management: list, detail, create, update, media, showcase, status, batch, remove, duplicate",
			"listing promotion, the skills vocabulary and the buyer preview",
		],
		modules: [
			"services/catalogue/analytics-fixtures.ts",
			"services/catalogue/clients-fixtures.ts",
			"services/catalogue/catalogue-fixtures.ts",
		],
		schemas: ["catalogue", "marketplace", "analytics"],
		description:
			"The seller's /catalogue console. Listing reads and writes are live under the catalogue policies and doors with no fixture branch (catalogue-fixtures.ts is stored rows for tests); Analytics and Clients read analytics.daily_rollups and catalogue.get_client_pipeline live and, gate off, answer deterministic fixtures per dev-axis state.",
	},
	comms: {
		domain: "comms",
		label: "Notifications & delivery",
		gate: "AUTH_BACKEND_LIVE",
		liveImplemented: true,
		fixtureRoad: true,
		gated: [
			"the notification centre and the /api/notifications inbox (off: fixtures)",
			"the notification dispatcher, delivery events and the one-click unsubscribe",
		],
		ungated: [],
		modules: ["services/comms/notification-fixtures.ts"],
		schemas: ["comms"],
		description:
			"The in-app inbox, the dispatcher that sends what it queues, and the provider's delivery and unsubscribe callbacks. Shares the auth gate because every read is the signed-in person's own.",
	},
	community: {
		domain: "community",
		label: "Helpfulness votes & feedback board",
		gate: "COMMUNITY_BACKEND_LIVE",
		liveImplemented: true,
		fixtureRoad: true,
		gated: [
			"the help centre's helpfulness votes",
			"the feedback board: ideas, votes, status history",
		],
		ungated: [],
		modules: ["services/community/feedback-fixtures.ts", "services/community/feedback-store.ts"],
		schemas: ["community"],
		description:
			"User-generated activity around the platform (Decision #274). Off, votes are validated and answered with nothing stored, and the board serves the seed's ideas from a per-process store that mirrors every door. The newsletter, also in `community`, keeps its own gate.",
	},
	contact: {
		domain: "contact",
		label: "Contact intake",
		gate: "CONTACT_BACKEND_LIVE",
		liveImplemented: true,
		fixtureRoad: true,
		gated: ["/contact submission and its attachments"],
		ungated: [],
		modules: [],
		schemas: ["ops", "files"],
		description:
			"ops.contact_requests through ops.submit_contact_request and the quarantine pipeline into the private `contact` bucket (Decision #276). Off, development answers a receipt and stores nothing; production refuses with a 503.",
	},
	context: {
		domain: "context",
		label: "Acting context",
		gate: null,
		alwaysLive:
			"Which team, business or enterprise a person acts as is a membership row; there is none to fake.",
		liveImplemented: true,
		fixtureRoad: false,
		gated: [],
		ungated: ["switching the acting context", "the enterprises a person belongs to"],
		modules: [],
		schemas: ["org"],
		description: "The acting-context switch and its enterprise list, read under the caller's JWT.",
	},
	editorial: {
		domain: "editorial",
		label: "Help centre, changelog & articles",
		gate: "EDITORIAL_BACKEND_LIVE",
		liveImplemented: true,
		fixtureRoad: true,
		gated: ["help centre", "changelog", "Projective's articles"],
		ungated: [],
		modules: [
			"services/editorial/content/help.ts",
			"services/editorial/content/changelog.ts",
			"services/editorial/content/articles.ts",
		],
		schemas: ["editorial"],
		description:
			"Platform-authored content (Decision #274). The content sources are the authored rows `deno task db:editorial:generate` writes into the seed, served off through the same Zod row parse and mapping the live read uses, so they cannot drift from the database.",
	},
	explore: {
		domain: "explore",
		label: "Discovery & entity view",
		gate: "EXPLORE_BACKEND_LIVE",
		liveImplemented: true,
		fixtureRoad: false,
		gated: [
			"whether resolveListing re-reads a listing fresh (on) or answers from the warmed catalogue snapshot (off); both are live reads",
		],
		ungated: [
			"discovery search, the home feed and the landing showcase",
			"/view/[entity] pages, item and related reads, testimonials, platform stats, the sitemap",
			"the project preview and the viewing history",
		],
		modules: [],
		schemas: ["search", "marketplace", "catalogue", "org", "projects", "reviews", "files"],
		description:
			"The discovery catalogue (services, products, articles, public projects, listed profiles, paid placements) and the entity projection, read live through the anon client (live-catalog.ts, live-view.ts). No fixture road: services/explore/fixtures.ts survives only as a dependency of other domains' fixtures.",
	},
	files: {
		domain: "files",
		label: "Asset hub",
		gate: "FILES_BACKEND_LIVE",
		liveImplemented: true,
		fixtureRoad: true,
		gated: [
			"link scanning: the Web Risk check, the guarded fetch and favicon/image re-hosting (off: stub verdicts)",
		],
		ungated: [
			"the /files hub: library, folder tree, mounted project files, quota, item inspect",
			"the upload pipeline, folder and file writes, sharing and access, the download ledger",
			"private object URLs (/api/files/object/[id])",
		],
		modules: [],
		schemas: ["files", "storage"],
		description:
			"The asset hub, read and written under the caller's own session (live-library, live-uploads, live-library-writes, live-access, live-objects). It never serves a sample library; the gate governs only outbound link scanning.",
	},
	finance: {
		domain: "finance",
		label: "Wallet, basket & checkout",
		gate: "FINANCE_BACKEND_LIVE",
		liveImplemented: true,
		fixtureRoad: true,
		gated: [
			"every money write: wallet moves, funding, payouts, billing, checkout and order placement (off: 503)",
			"the Stripe fiat rails, disputes, ledger health and escrow age",
			"the plan read (off: no plan), the proposal allowance (off: stub) and a ticket's funding quote (off: fixture)",
		],
		ungated: [
			"wallet reads: balances, ledger, escrow, payouts, methods, invoices, documents",
			"the basket, saved cards, orders, the checkout session and buyer details, the billing view",
			"currency conversion (finance.fx_rates)",
		],
		modules: [],
		schemas: ["finance", "projects", "org"],
		description:
			"Money. Reads are deliberately live under the caller's JWT; writes go through finance.* and projects.fund_stage doors and refuse with the gate off. The Stripe rails also need a well-formed STRIPE_SECRET_KEY.",
	},
	integrations: {
		domain: "integrations",
		label: "Connectors & rooms",
		gate: "INTEGRATIONS_BACKEND_LIVE",
		liveImplemented: true,
		fixtureRoad: false,
		gated: [
			"the OAuth consent and callback, token refresh and channel renewal",
			"storage connector actions, calendar sync, room link minting and the token vault",
		],
		ungated: [
			"the provider catalogue and the caller's connections",
			"revoking a connection, its sync direction, browsing and importing from it",
			"the provider webhook and joining a room",
		],
		modules: [],
		schemas: ["integrations", "scheduling"],
		description:
			"Third-party connectors (Decision #313: they never return to fixtures) and meeting rooms. Off, the gated steps refuse in words; no provider ships enabled.",
	},
	legal: {
		domain: "legal",
		label: "Legal acceptance",
		gate: "AUTH_BACKEND_LIVE",
		liveImplemented: true,
		fixtureRoad: true,
		gated: ["re-accepting changed terms (off: answered, nothing stored)"],
		ungated: [],
		modules: [],
		schemas: ["security"],
		description: "Recording a person's acceptance of the current legal documents.",
	},
	logging: {
		domain: "logging",
		label: "Logs & web vitals",
		gate: "LOGGING_BACKEND_LIVE",
		liveImplemented: true,
		fixtureRoad: true,
		gated: ["warn/error ingest, web vitals and server 5xx records (off: console echo)"],
		ungated: [],
		modules: [],
		schemas: ["ops"],
		description:
			"ops.log_entries. Orthogonal to DENO_ENV: this gates persistence, the environment gates verbosity.",
	},
	marketing: {
		domain: "marketing",
		label: "Public figures",
		gate: "FINANCE_BACKEND_LIVE",
		liveImplemented: true,
		fixtureRoad: true,
		gated: [
			"the thresholded platform figures on /about, the landing page and GET /api/public/metrics",
		],
		ungated: [],
		modules: ["services/marketing/public-metrics-fixtures.ts"],
		schemas: ["finance"],
		description:
			"finance.public_metrics() read with the service role (Decision #277); off, an aggregate frozen from the seeded database. A multi-currency total also needs the live FX table and is withheld without it.",
	},
	media: {
		domain: "media",
		label: "Media library & proxy",
		gate: null,
		alwaysLive: "It serves a person's own stored bytes and renditions; there is nothing to fake.",
		liveImplemented: true,
		fixtureRoad: false,
		gated: [],
		ungated: [
			"the media library and its upload pipeline",
			"the media proxy stream",
			"showcase renditions and OAuth avatars (reached from profile, messaging, catalogue, files)",
		],
		modules: [],
		schemas: ["files", "storage"],
		description:
			"Image and video storage behind profiles, group photos, listing media and the hub, read and written under the caller's session and streamed through the service-role proxy.",
	},
	messaging: {
		domain: "messaging",
		label: "Global messaging",
		gate: "MESSAGING_BACKEND_LIVE",
		liveImplemented: true,
		fixtureRoad: true,
		gated: [
			"the /messages inbox, a conversation and its message pages, contacts, settings, files and roster",
			"starring, muting, pinning and read markers (off: some refuse, some echo)",
		],
		ungated: ["rendering a group photo (through media), on the fixture road too"],
		modules: [
			"services/messaging/conversation-fixtures.ts",
			"services/messaging/messages-fixtures.ts",
			"services/messaging/settings-fixtures.ts",
			"services/messaging/workspace-fixtures.ts",
			"services/messaging/context-fixtures.ts",
			"services/messaging/suggestion-fixtures.ts",
			"services/profile/profile-fixtures.ts",
		],
		schemas: ["comms"],
		description:
			"Direct and group conversations and project channels, unified by chatId (live-queries, live-workspace, live-contacts, live-settings). The fixture road's people come from profile-fixtures.ts.",
	},
	newsletter: {
		domain: "newsletter",
		label: "Newsletter",
		gate: "NEWSLETTER_BACKEND_LIVE",
		liveImplemented: true,
		fixtureRoad: true,
		gated: [
			"subscribe, the confirmation link, confirm and unsubscribe (off: answered, nothing stored)",
		],
		ungated: [],
		modules: [],
		schemas: ["community"],
		description:
			"community.newsletter_subscriptions through community.subscribe_newsletter with the service role (Decision #274), with a double opt-in.",
	},
	ops: {
		domain: "ops",
		label: "Scheduled jobs",
		gate: null,
		alwaysLive:
			"An operator tool over ops.scheduled_jobs and ops.run_job; a demo registry would run nothing.",
		liveImplemented: true,
		fixtureRoad: false,
		gated: [],
		ungated: ["listing scheduled jobs", "running one now (scripts/cron-run.ts)"],
		modules: [],
		schemas: ["ops"],
		description: "The scheduled-jobs registry, read and run with the service role.",
	},
	profile: {
		domain: "profile",
		label: "Public profiles",
		gate: null,
		alwaysLive:
			"It reads org.users_public and the profile tables; its PROFILE_BACKEND_LIVE gate never had a consumer and was retired (LD3).",
		liveImplemented: true,
		fixtureRoad: false,
		gated: [],
		ungated: [
			"the /[handle] overview, its tabs, services, products and call offer",
			"the owner's editor and its saves, media, showcase, portfolio and availability",
			"follows and connections",
		],
		modules: [],
		schemas: ["org", "reviews", "scheduling"],
		description:
			"The public profile and its owner's editor, read and written under the caller's JWT (live-profile, live-profile-writes, live-follows). services/profile/profile-fixtures.ts is messaging's fixture corpus, not a road of this domain.",
	},
	projects: {
		domain: "projects",
		label: "Projects, tickets & workspace",
		gate: "PROJECTS_BACKEND_LIVE",
		liveImplemented: true,
		fixtureRoad: true,
		gated: [
			"every read: the feed, detail, overview, setup, board and tickets, timeline, members, files, messages, submissions",
			"every write (off: the stub store)",
			"invite links and nav activity",
		],
		ungated: ["resolving the listing a service is instantiated from (through explore)"],
		modules: [
			"services/projects/fixtures.ts",
			"services/projects/detail-fixtures.ts",
			"services/projects/board-fixtures.ts",
			"services/projects/files-fixtures.ts",
			"services/projects/members-fixtures.ts",
			"services/projects/messages-fixtures.ts",
			"services/projects/submissions-fixtures.ts",
			"services/projects/overview-fixtures.ts",
			"services/projects/setup-fixtures.ts",
			"services/projects/structure-fixtures.ts",
			"services/projects/nav-activity-fixtures.ts",
			"services/projects/draft-store.ts",
		],
		schemas: ["projects", "comms", "files"],
		description:
			"The project feed and everything inside a project, read under the caller's JWT (live-queries, live-detail, live-board, live-members, live-files, live-submissions, live-messages) and written through live-writes. Some read fields come back neutral rather than invented where no column backs them.",
	},
	quotes: {
		domain: "quotes",
		label: "Custom quotes",
		gate: null,
		alwaysLive:
			"A quote request is a door between two real people (Decision #458); there is none to fake.",
		liveImplemented: true,
		fixtureRoad: false,
		gated: [],
		ungated: ["the quotes between two people", "acting on a quote", "requesting one"],
		modules: [],
		schemas: ["marketplace", "org"],
		description:
			"Custom quote requests and the host's priced offers, each a marketplace door run as the caller.",
	},
	saved: {
		domain: "saved",
		label: "Saved things",
		gate: null,
		alwaysLive:
			"There are no fixtures to save into; the Dev Context Switcher's `saved` axis substitutes client-side.",
		liveImplemented: true,
		fixtureRoad: false,
		gated: [],
		ungated: ["star, save and favourite toggles", "/saved and its pins and state lookups"],
		modules: [],
		schemas: ["org", "projects", "comms", "files"],
		description:
			"Every star, save and favourite, kept in the store each kind already had (bookmarks, the project star, the conversation star, message favourites, the file star).",
	},
	scheduling: {
		domain: "scheduling",
		label: "Calendar & availability",
		gate: null,
		alwaysLive:
			"Calendars, availability and slot grids are scheduling.* rows; no scheduling file consults a gate (the old registry's PROJECTS_BACKEND_LIVE was never checked).",
		liveImplemented: true,
		fixtureRoad: false,
		gated: [],
		ungated: [
			"public availability, a session listing's schedule and every bookable slot grid",
			"the project, channel and personal calendars, RSVP and reschedule",
			"hosting: entries, invitations, clashes, reminders, routines, presets and blackouts",
			"guest invitations and their mail, occurrence compiling and horizon extension",
		],
		modules: [],
		schemas: ["scheduling"],
		description:
			"Public reads through the anonymous client; the calendars and coordination as the signed-in user (live-calendar, live-entries) and writes through the service role after the SSOT's rules (coordination-plan, live-coordination-writes).",
	},
	search: {
		domain: "search",
		label: "Discovery signals & embeddings",
		gate: "EXPLORE_BACKEND_LIVE",
		liveImplemented: true,
		fixtureRoad: true,
		gated: ["the discovery query log and interest events (off: acknowledged, nothing stored)"],
		ungated: [
			"the embedding index, behind its own EMBEDDINGS_ENABLED switch (isEmbeddingsLive), and the backfill script",
		],
		modules: [],
		schemas: ["search"],
		description:
			"What discovery learns from: queries, impressions and clicks, and the voyage-4 vectors semantic ranking reads.",
	},
	sessions: {
		domain: "sessions",
		label: "Cohort sessions",
		gate: "PROJECTS_BACKEND_LIVE",
		liveImplemented: true,
		fixtureRoad: true,
		gated: ["seats, waitlist, the session workspace, lessons and sittings"],
		ungated: ["the room presence webhook"],
		modules: ["services/sessions/session-fixtures.ts"],
		schemas: ["scheduling", "projects", "marketplace"],
		description:
			"A cohort listing's offer and its sittings. The public cohort offer answers its fixture under USE_MOCKS directly (useMocks()); the presence webhook needs the database.",
	},
	user: {
		domain: "user",
		label: "Account & settings",
		gate: "AUTH_BACKEND_LIVE",
		liveImplemented: true,
		fixtureRoad: true,
		gated: [
			"me, settings, emails, the notification centre preferences",
			"account lifecycle, data export and the sign-in change",
		],
		ungated: [
			"the profile card in `me` (off: no card)",
			"the rail's right-click previews (through workspace and catalogue)",
		],
		modules: [],
		schemas: ["org", "security", "comms", "auth"],
		description:
			"The signed-in person's own account. Off, it answers defaults or in-memory values and stores nothing.",
	},
	workspace: {
		domain: "workspace",
		label: "Teams & businesses",
		gate: "MESSAGING_BACKEND_LIVE",
		liveImplemented: true,
		fixtureRoad: true,
		gated: ["which conversation an entity channel opens (off: its fixture conversation id)"],
		ungated: [
			"the whole Teams & Businesses console: roster, detail, bench, create, update, members, roles",
			"invitations, invite links and join requests, payout and spend settings, channels",
		],
		modules: [],
		schemas: ["org", "finance", "comms"],
		description:
			"The /teams and /businesses console, live-only since 2026-09-28 through the org/finance definer RPCs under the caller's session. The messaging gate only picks which conversation a channel opens, so a channel lands in the inbox the messaging gate serves.",
	},
});

/** Every domain key, for iteration. */
export const MOCK_DOMAINS = Object.keys(MOCK_REGISTRY) as readonly MockDomain[];

/**
 * Domains whose gate exists but has no database path behind it: a gate set to `true` for any of these
 * changes nothing. Empty today; the contract test keeps it honest if one appears.
 */
export function domainsAwaitingLiveBackend(): readonly MockDomainInfo[] {
	return MOCK_DOMAINS
		.map((d) => MOCK_REGISTRY[d])
		.filter((info) => !info.liveImplemented);
}
