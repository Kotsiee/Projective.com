/**
 * registry.ts — the manifest of every mock dataset on the platform, and the gate that governs it.
 *
 * ## What this is for
 *
 * Before this module there was no way to answer "what is currently mocked, and what would it take to
 * make it real?" without opening thirty-five files. The fixture modules were consolidated by
 * CONVENTION (`services/<domain>/*-fixtures.ts`) but nothing enumerated them, so the mock corpus had
 * no inventory and no single place to ask whether a given surface is serving real data.
 *
 * This registry is that inventory. It is deliberately DATA, not behaviour: it does not import a
 * single fixture module, so listing the corpus costs nothing at runtime and adding a row cannot drag
 * a dataset into a bundle. {@link ./mod.ts} is the module that actually re-exports the datasets.
 *
 * ## The relationship to the `*_BACKEND_LIVE` gates
 *
 * Each row names the environment gate that decides whether its domain answers from fixtures or from
 * Supabase. `liveImplemented` is the honest and uncomfortable field: it records whether a real
 * database path exists BEHIND that gate at all.
 *
 * Measured across the service layer, seventeen of the twenty fat services contain zero Supabase
 * calls. Their "live" branch is a comment followed by a fall-through to the same fixtures — for
 * example `CatalogueBackendService.list` tests the gate, returns the fixture page when it is off, and
 * then returns the identical fixture page when it is on. Flipping those gates therefore changes
 * nothing today, which is a fact a reader of `.env.example` alone would never learn, and the single
 * most important thing this registry records. `API_BACKLOG.md` is the work queue that closes it.
 */

/** The environment flag governing one domain's fixture-vs-database choice. */
export type BackendGate =
	| "AUTH_BACKEND_LIVE"
	| "EXPLORE_BACKEND_LIVE"
	| "PROFILE_BACKEND_LIVE"
	| "PROJECTS_BACKEND_LIVE"
	| "MESSAGING_BACKEND_LIVE"
	| "CATALOGUE_BACKEND_LIVE"
	| "NEWSLETTER_BACKEND_LIVE"
	| "FINANCE_BACKEND_LIVE"
	| "WORKSPACE_BACKEND_LIVE"
	| "FILES_BACKEND_LIVE"
	| "INTEGRATIONS_BACKEND_LIVE"
	| "LOGGING_BACKEND_LIVE";

/** The mock domains, one per fat-service area. */
export type MockDomain =
	| "auth"
	| "explore"
	| "profile"
	| "projects"
	| "messaging"
	| "catalogue"
	| "newsletter"
	| "finance"
	| "workspace"
	| "files"
	| "integrations"
	| "scheduling"
	| "shell"
	| "marketing";

/** One row of the mock inventory. */
export interface MockDomainInfo {
	/** The domain key. */
	domain: MockDomain;
	/** Human label for tooling and docs. */
	label: string;
	/** The env flag that flips this domain between fixtures and Supabase. */
	gate: BackendGate;
	/**
	 * Whether a REAL database path exists behind {@link MockDomainInfo.gate}.
	 *
	 * `false` means the live branch currently falls through to the same fixtures, so setting the gate
	 * to `true` is a no-op. See the module docblock.
	 */
	liveImplemented: boolean;
	/** Repo-relative fixture modules backing this domain. */
	modules: readonly string[];
	/** Postgres schemas the live path will read once implemented. */
	schemas: readonly string[];
	/** What the dataset covers. */
	description: string;
}

/**
 * The mock inventory.
 *
 * `liveImplemented` was established by counting real Supabase calls (`getUserClient`,
 * `getServiceClient`, `.from(`) in each fat service, not by reading its documentation — several
 * services describe a live path in prose that their code does not contain.
 */
export const MOCK_REGISTRY: Readonly<Record<MockDomain, MockDomainInfo>> = Object.freeze({
	auth: {
		domain: "auth",
		label: "Authentication & session",
		gate: "AUTH_BACKEND_LIVE",
		liveImplemented: true,
		modules: [],
		schemas: ["auth", "org", "security"],
		description:
			"Sign-in, join, OAuth, verification, refresh and sign-out. One of only three services with a real GoTrue/Supabase path.",
	},
	explore: {
		domain: "explore",
		label: "Discovery & entity view",
		gate: "EXPLORE_BACKEND_LIVE",
		liveImplemented: true,
		modules: [],
		schemas: ["search", "marketplace", "catalogue", "org", "projects", "reviews", "files"],
		description:
			"The discovery catalogue (services, products, articles, public projects, listed profiles, paid placements) and the /view/[id] entity projection, read live through the anon client by services/explore/live-catalog.ts and live-view.ts. services/explore/fixtures.ts survives only as a dependency of other domains' fixtures and leaves with them.",
	},
	profile: {
		domain: "profile",
		label: "Public profiles",
		gate: "PROFILE_BACKEND_LIVE",
		liveImplemented: false,
		modules: ["services/profile/profile-fixtures.ts"],
		schemas: ["org", "reviews"],
		description:
			"The /[handle] profile overview and every per-kind tab, derived deterministically from the discovery corpus so a profile agrees with the card that linked to it.",
	},
	projects: {
		domain: "projects",
		label: "Projects, tickets & workspace",
		gate: "PROJECTS_BACKEND_LIVE",
		// LIVE, on both sides. All eight reads reach Postgres under the caller's JWT
		// (`services/projects/live-{queries,detail,board,members,files,submissions,messages}.ts`), and
		// CREATE now inserts `projects.projects` plus its one root stage through the RLS-scoped client
		// (`live-writes.ts insertProject`) rather than shaping a slug and persisting nothing.
		// Several READ fields still come back NEUTRAL rather than invented, because no column backs
		// them — a project channel has no per-viewer read watermark, `categoryWeight` has no column at
		// all, and there is no presence signal anywhere. Each is documented where it is produced.
		liveImplemented: true,
		modules: [
			"services/projects/fixtures.ts",
			"services/projects/detail-fixtures.ts",
			"services/projects/board-fixtures.ts",
			"services/projects/files-fixtures.ts",
			"services/projects/members-fixtures.ts",
			"services/projects/messages-fixtures.ts",
			"services/projects/submissions-fixtures.ts",
			"services/projects/draft-store.ts",
		],
		schemas: ["projects", "comms", "files"],
		description:
			"The project feed, a project detail projection, the Kanban board and tickets, channel attachments, the member roster, the chat feed and the submissions tree.",
	},
	messaging: {
		domain: "messaging",
		label: "Global messaging",
		gate: "MESSAGING_BACKEND_LIVE",
		// LIVE. All seven reads reach Postgres
		// (`services/messaging/live-{queries,workspace,contacts,settings}.ts`). NOTE the dependency:
		// the DM stack's SELECT policies were added in `00002012_policies_comms.sql` — those five
		// tables had RLS enabled with zero policies, which returns `200 []` rather than an error, so
		// without them this domain reports live and serves an empty inbox.
		liveImplemented: true,
		modules: [
			"services/messaging/conversation-fixtures.ts",
			"services/messaging/messages-fixtures.ts",
			"services/messaging/settings-fixtures.ts",
			"services/messaging/workspace-fixtures.ts",
		],
		schemas: ["comms"],
		description:
			"The /messages inbox, a conversation detail and message page, contacts, per-user messaging settings, and a conversation's files and roster.",
	},
	catalogue: {
		domain: "catalogue",
		label: "Seller catalogue",
		gate: "CATALOGUE_BACKEND_LIVE",
		liveImplemented: true,
		modules: [],
		schemas: ["catalogue", "marketplace"],
		description:
			"LIVE. The seller's own listings read under the catalogue policies (live-catalogue); sales from catalogue.get_listing_sales; create/update/publish through catalogue.create_listing / save_listing / set_listing_status, which keep each listing and its product or service blueprint in step in one transaction.",
	},
	newsletter: {
		domain: "newsletter",
		label: "Newsletter opt-in",
		gate: "NEWSLETTER_BACKEND_LIVE",
		liveImplemented: false,
		modules: [],
		schemas: ["comms"],
		description:
			"Footer and landing newsletter capture. Accepts an opt-in into a no-op stub; no subscriptions table exists.",
	},
	finance: {
		domain: "finance",
		label: "Wallet, basket & checkout",
		gate: "FINANCE_BACKEND_LIVE",
		liveImplemented: true,
		modules: [],
		schemas: ["finance", "projects", "org"],
		description:
			"LIVE. The basket, saved cards, buyer details, the checkout session and orders read and write finance.* as the signed-in caller (live-basket, live-cards, live-buyer, live-orders, commerce-owner); a checkout is paid from the Projective wallet (finance.place_wallet_order). The /wallet surface reads balances, ledger, escrow, payouts, methods, invoices and vault governance live (wallet-scope, wallet-ledger, live-wallet, wallet-standing) and moves money through finance.transfer_funds / distribute_vault and projects.fund_stage (wallet-actions). Card, device-wallet, PayPal, top-up, withdrawal, recurring-deposit and Income-Smoother paths need a payment processor and are refused with that reason. Currency conversion reads finance.fx_rates (FxService.ts).",
	},
	workspace: {
		domain: "workspace",
		label: "Teams & businesses",
		gate: "WORKSPACE_BACKEND_LIVE",
		liveImplemented: false,
		modules: ["services/workspace/workspace-fixtures.ts"],
		schemas: ["org", "finance"],
		description:
			"The multi-member entity console: roster, three-layer permissions, payout splits and spend governance. Its live path reads tables that already exist.",
	},
	files: {
		domain: "files",
		label: "Asset hub",
		gate: "FILES_BACKEND_LIVE",
		liveImplemented: true,
		modules: [],
		schemas: ["files", "storage"],
		description:
			"LIVE. The /files hub read under the caller's own session (live-library): the acting library, its folder tree, mounted project files, the storage allowance (files.get_storage_quota), the quarantine upload pipeline (live-uploads), share links and the download ledger (files.fn_record_download); private bytes are served through /api/files/object/[id].",
	},
	integrations: {
		domain: "integrations",
		label: "Connectors & plugins",
		gate: "INTEGRATIONS_BACKEND_LIVE",
		liveImplemented: true,
		modules: [],
		schemas: ["integrations"],
		description:
			"LIVE. The provider catalogue and the caller's connections (v_my_connections). Connecting, browsing and mounting refuse in words: no provider is enabled and no OAuth client or vault key is configured in this deployment.",
	},
	scheduling: {
		domain: "scheduling",
		label: "Calendar & booking",
		gate: "PROJECTS_BACKEND_LIVE",
		liveImplemented: true,
		modules: [],
		schemas: ["scheduling"],
		description:
			"LIVE. Public reads (a provider's availability, a session listing's schedule, every bookable slot grid) read scheduling.* through the anonymous client; the project/channel calendar, the personal /calendar agenda and RSVP/reschedule coordination read as the signed-in user (live-calendar.ts) and write through the service role after the SSOT's rules (coordination-plan.ts, live-coordination-writes.ts, scheduling.close_reschedule_round).",
	},
	shell: {
		domain: "shell",
		label: "Navigation shell",
		gate: "PROJECTS_BACKEND_LIVE",
		liveImplemented: false,
		modules: ["apps/web/features/shell/core/nav-fixtures.ts"],
		schemas: ["org", "comms"],
		description:
			"Recent workspaces, offerings, notifications and account capabilities. Lives app-side because islands read it directly and may not import this package.",
	},
	marketing: {
		domain: "marketing",
		label: "Marketing landing",
		gate: "EXPLORE_BACKEND_LIVE",
		liveImplemented: true,
		modules: [],
		schemas: ["search", "marketplace", "catalogue", "reviews"],
		description:
			"The public landing: showcase sections from the live home feed, real reviews as testimonials, and the hero's running totals from search.platform_stats (ExploreBackendService.landing()).",
	},
});

/** Every domain key, for iteration. */
export const MOCK_DOMAINS = Object.keys(MOCK_REGISTRY) as readonly MockDomain[];

/**
 * Domains whose gate exists but has no database path behind it.
 *
 * This is the honest read of "what is still mocked": a gate set to `true` for any of these changes
 * nothing, so this list — not the env file — is the accurate picture of what remains to build.
 */
export function domainsAwaitingLiveBackend(): readonly MockDomainInfo[] {
	return MOCK_DOMAINS
		.map((d) => MOCK_REGISTRY[d])
		.filter((info) => !info.liveImplemented);
}
