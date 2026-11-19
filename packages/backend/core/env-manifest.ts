/**
 * env-manifest — every environment variable name Projective knows, as pure data.
 *
 * This is the one list the server's reader (`core/env.ts`), the Supabase CLI's `env()` references in
 * `supabase/config.toml`, the operator tooling under `scripts/` and `.env.example` are measured
 * against (SECRETS_CONFIG_BUILD_PROMPTS.md CFG1, PRD-H4/H5). `deno task deploy:check`
 * (`scripts/deploy-check.ts`, OPERATIONS_BUILD_PROMPTS.md OPS6, PRD-G8) reads its required list from
 * here and keeps no list of its own.
 *
 * It holds names and facts about names, never a value. Nothing here reads `Deno.env`.
 */

// #region Shape
/** Who reads the variable. */
export type EnvReader =
	/** The app, through `core/env.ts` (or a direct read CFG1 routes through it). */
	| "app"
	/** The Supabase CLI, through an `env(NAME)` in `supabase/config.toml`. The app never reads it. */
	| "supabase-cli"
	/** A `deno task` script, a test harness or the operator's own tooling. Never the running app. */
	| "tooling";

/**
 * What the value is. A `secret` is `XXXX-XXXX` in `.env.example`; a `gate` is a boolean parsed as
 * `(value ?? "false").toLowerCase() === "true"` and is `false` there; a `url` is an absolute URL;
 * `config` is anything else, public keys included.
 */
export type EnvKind = "secret" | "gate" | "url" | "config";

/** An environment a release runs in. `development` is a local checkout. */
export type EnvTarget = "development" | "staging" | "production";

/** The two hosted targets. */
export const HOSTED_TARGETS = ["staging", "production"] as const satisfies readonly EnvTarget[];

/** A hosted target, as `deploy:check --target` takes it. */
export type HostedTarget = typeof HOSTED_TARGETS[number];

/**
 * Where a value may live beyond what `requiredIn` says.
 *
 * - `development`: a local override (a mock's base URL, a test harness setting). A hosted app env
 *   that holds it is refused by `deploy:check`.
 * - `operator`: an operator's credential for tooling (a personal access token, a database URL). It
 *   belongs in the operator's own env file, never in the environment a host receives.
 */
export type EnvConfine = "development" | "operator";

/** One environment variable. */
export interface EnvEntry {
	/** The exact variable name. */
	name: string;
	reader: EnvReader;
	kind: EnvKind;
	/** `live` once code reads it; `planned` while the work order in {@link EnvEntry.plannedBy} builds it. */
	status: "live" | "planned";
	/** The work order that makes a `planned` key live, e.g. `"COMMS NT4"`. Set exactly when planned. */
	plannedBy?: string;
	/** The targets where a missing or placeholder value is an error. Empty: optional everywhere. */
	requiredIn: readonly EnvTarget[];
	/** See {@link EnvConfine}. Absent: no restriction. */
	confine?: EnvConfine;
}
// #endregion

// #region Builders
const ALL: readonly EnvTarget[] = ["development", "staging", "production"];
const HOSTED: readonly EnvTarget[] = HOSTED_TARGETS;
const PRODUCTION: readonly EnvTarget[] = ["production"];
const DEVELOPMENT: readonly EnvTarget[] = ["development"];
const NONE: readonly EnvTarget[] = [];

function app(name: string, kind: EnvKind, requiredIn: readonly EnvTarget[] = NONE): EnvEntry {
	return { name, reader: "app", kind, status: "live", requiredIn };
}

function cli(name: string, kind: EnvKind, requiredIn: readonly EnvTarget[] = NONE): EnvEntry {
	return { name, reader: "supabase-cli", kind, status: "live", requiredIn };
}

function tool(name: string, kind: EnvKind, confine?: EnvConfine): EnvEntry {
	return {
		name,
		reader: "tooling",
		kind,
		status: "live",
		requiredIn: NONE,
		...(confine ? { confine } : {}),
	};
}

function planned(
	name: string,
	reader: EnvReader,
	kind: EnvKind,
	plannedBy: string,
	requiredIn: readonly EnvTarget[] = NONE,
	confine?: EnvConfine,
): EnvEntry {
	return {
		name,
		reader,
		kind,
		status: "planned",
		plannedBy,
		requiredIn,
		...(confine ? { confine } : {}),
	};
}

/** Every `*_BACKEND_LIVE` gate `core/env.ts` reads. Each hosted target sets each one deliberately. */
const BACKEND_GATES = [
	"AUTH_BACKEND_LIVE",
	"EXPLORE_BACKEND_LIVE",
	"NEWSLETTER_BACKEND_LIVE",
	"EDITORIAL_BACKEND_LIVE",
	"COMMUNITY_BACKEND_LIVE",
	"CONTACT_BACKEND_LIVE",
	"PROJECTS_BACKEND_LIVE",
	"MESSAGING_BACKEND_LIVE",
	"CATALOGUE_BACKEND_LIVE",
	"LOGGING_BACKEND_LIVE",
	"FINANCE_BACKEND_LIVE",
	"FILES_BACKEND_LIVE",
	"INTEGRATIONS_BACKEND_LIVE",
] as const;

/** The scheduler bearers: each is also a Vault secret of the same name (`ops.scheduled_jobs.secret_name`). */
const CRON_BEARERS = [
	"FINANCE_CRON_SECRET",
	"ACCOUNT_CRON_SECRET",
	"SCHEDULING_CRON_SECRET",
	"CONTACT_CRON_SECRET",
	"INTEGRATIONS_CRON_SECRET",
	"SEARCH_CRON_SECRET",
	"OPS_CRON_SECRET",
	"COMMS_DISPATCH_SECRET",
] as const;

/** The test harness variables under `apps/web/tests/e2e/`. */
const E2E_VARIABLES = [
	"E2E_AREAS",
	"E2E_ARTIFACTS",
	"E2E_BASE_URL",
	"E2E_CHROMIUM",
	"E2E_CONTACT_BASE_URL",
	"E2E_DB_CONTAINER",
	"E2E_DOCKER",
	"E2E_IDENTIFIER",
	"E2E_LANDING_URL",
	"E2E_PASSWORD",
	"E2E_PATIENCE_MS",
	"E2E_PAYPAL_PATH",
	"E2E_PUBLIC_BASE_URL",
	"E2E_PUBLIC_BUDGET_BASE_URL",
	"E2E_PUBLIC_ONLY",
	"E2E_PUBLIC_VARIANTS",
	"E2E_SHOTS",
	"E2E_SITE_ORIGIN",
	"E2E_STRIPE_PAYPAL",
] as const;
// #endregion

// #region The manifest
/**
 * Every known variable. `requiredIn` for the hosted targets is the release contract
 * `deploy:check` enforces; the owner reviews it with each release (DEPLOYMENT_RUNBOOK.md).
 */
export const ENV_MANIFEST: readonly EnvEntry[] = [
	// Application
	app("DENO_ENV", "config", HOSTED),
	app("APP_URL", "url", HOSTED),
	app("PORT", "config"),

	// Supabase
	app("SUPABASE_URL", "url", ALL),
	app("SUPABASE_PUBLIC_URL", "url"),
	app("SUPABASE_ANON_KEY", "config", ALL),
	app("SUPABASE_SERVICE_ROLE_KEY", "secret", ALL),
	app("SUPABASE_JWT_SECRET", "secret"),

	// Data source switches
	app("USE_MOCKS", "gate"),
	app("VITE_USE_MOCKS", "gate"),
	...BACKEND_GATES.map((name) => app(name, "gate", HOSTED)),
	app("EMBEDDINGS_ENABLED", "gate", HOSTED),

	// Search
	app("VOYAGE_API_KEY", "secret"),
	{ ...app("VOYAGE_API_BASE", "url"), confine: "development" },

	// Stripe
	app("STRIPE_SECRET_KEY", "secret", HOSTED),
	app("STRIPE_WEBHOOK_SECRET", "secret", HOSTED),
	app("STRIPE_THIN_WEBHOOK_SECRET", "secret", HOSTED),
	app("STRIPE_CONNECT_WEBHOOK_SECRET", "secret", HOSTED),
	app("NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY", "config", HOSTED),
	{ ...app("STRIPE_API_BASE", "url"), confine: "development" },
	app("STRIPE_PAYMENT_METHOD_DOMAINS", "config"),
	app("STRIPE_APPLE_PAY_DOMAIN_ASSOCIATION", "config"),

	// The scheduler's bearers
	...CRON_BEARERS.map((name) => app(name, "secret", HOSTED)),

	// Alerts (MR4, Decision #461)
	app("OPS_ALERT_WEBHOOK_URL", "url", PRODUCTION),
	app("OPS_ALERT_EMAIL", "config", PRODUCTION),

	// Files, links and the token vault
	app("LINK_SAFETY_API_KEY", "secret"),
	app("ENCRYPTION_KEY", "secret", HOSTED),
	app("S3_ACCESS_KEY_ID", "secret"),
	app("S3_SECRET_ACCESS_KEY", "secret"),

	// Integrations (connection OAuth)
	app("GOOGLE_INTEGRATION_CLIENT_ID", "config"),
	app("GOOGLE_INTEGRATION_CLIENT_SECRET", "secret"),
	app("MICROSOFT_INTEGRATION_CLIENT_ID", "config"),
	app("MICROSOFT_INTEGRATION_CLIENT_SECRET", "secret"),
	app("MICROSOFT_INTEGRATION_TENANT", "config"),
	app("ZOOM_CLIENT_ID", "config"),
	app("ZOOM_CLIENT_SECRET", "secret"),
	app("ZOOM_WEBHOOK_SECRET", "secret"),
	app("DROPBOX_CLIENT_ID", "config"),
	app("DROPBOX_CLIENT_SECRET", "secret"),
	app("FRAMEIO_CLIENT_ID", "config"),
	app("FRAMEIO_CLIENT_SECRET", "secret"),

	// Mail and push
	app("RESEND_API_KEY", "secret", HOSTED),
	app("MAIL_FROM", "config", HOSTED),
	app("RESEND_WEBHOOK_SECRET", "secret", HOSTED),
	app("VAPID_PUBLIC_KEY", "config"),
	app("VAPID_PRIVATE_KEY", "secret"),
	app("VAPID_SUBJECT", "config"),

	// Bot mitigation (Decision #447)
	app("TURNSTILE_SITE_KEY", "config", ALL),
	app("TURNSTILE_SECRET_KEY", "secret", ALL),

	// Read only by the Supabase CLI (supabase/config.toml)
	cli("SUPABASE_AUTH_CAPTCHA_SECRET", "secret", DEVELOPMENT),
	cli("SUPABASE_AUTH_SMTP_PASS", "secret"),
	cli("SUPABASE_AUTH_SMTP_ADMIN_EMAIL", "config"),
	cli("SUPABASE_AUTH_SMS_TWILIO_AUTH_TOKEN", "secret"),
	cli("SUPABASE_AUTH_EXTERNAL_APPLE_SECRET", "secret"),
	cli("GOOGLE_CLIENT_ID", "config"),
	cli("GOOGLE_CLIENT_SECRET", "secret"),
	cli("OPENAI_API_KEY", "secret"),
	cli("S3_HOST", "url"),
	cli("S3_REGION", "config"),
	cli("S3_ACCESS_KEY", "secret"),
	cli("S3_SECRET_KEY", "secret"),

	// Operator tooling
	tool("SUPABASE_PROJECT_REF", "config", "operator"),
	tool("SUPABASE_ACCESS_TOKEN", "secret", "operator"),
	tool("STRIPE_PREFLIGHT_KEY", "secret"),
	tool("CRON_APP_URL", "url"),
	tool("CRON_VAULT_DB_URL", "secret", "operator"),
	tool("CRON_VAULT_DB_CA", "config", "operator"),

	// Local tooling and test harnesses
	tool("PROBES_DB_CONTAINER", "config", "development"),
	tool("SMOKE_DB_CONTAINER", "config", "development"),
	tool("STRIPE_MOCK_URL", "url", "development"),
	...E2E_VARIABLES.map((name) => tool(name, "config", "development")),

	// Planned: each flips to live in the change that builds it
	planned("OPS_HEALTH_TOKEN", "app", "secret", "OPS5", PRODUCTION),
	planned("SAFETY_NODE_URL", "app", "url", "T&S SN1"),
	planned("SAFETY_NODE_TOKEN", "app", "secret", "T&S SN1"),
	planned("MALWARE_SCAN_LIVE", "app", "gate", "T&S SN1"),
	planned("MODERATION_BACKEND_LIVE", "app", "gate", "T&S SN1"),
	planned("MODERATION_CRON_SECRET", "app", "secret", "T&S SN1"),
	planned("FILES_CRON_SECRET", "app", "secret", "T&S SN1"),
	planned("AUTH_SSO_ENABLED", "app", "gate", "SSO1"),
	planned("TWILIO_AUTH_TOKEN", "app", "secret", "COMMS NT5"),
];
// #endregion

// #region Queries
/** The entry for `name`, or `undefined` when the manifest does not know it. */
export function manifestEntry(name: string): EnvEntry | undefined {
	return ENV_MANIFEST.find((entry) => entry.name === name);
}

/**
 * The names a release on `target` must set to a real value: live entries whose `requiredIn` names
 * the target. A planned key is never required until its work order makes it live.
 */
export function requiredIn(target: EnvTarget): string[] {
	return ENV_MANIFEST
		.filter((entry) => entry.status === "live" && entry.requiredIn.includes(target))
		.map((entry) => entry.name);
}

/** The two names of the no-database switch (`env.ts` reads them in this order). Never on when hosted. */
export const MOCK_SWITCHES = ["USE_MOCKS", "VITE_USE_MOCKS"] as const;

/**
 * The live feature gates the app reads, without the {@link MOCK_SWITCHES}: what a release declares
 * per hosted target (`deploy/release-gates.json`).
 */
export function liveAppGates(): string[] {
	const mock: readonly string[] = MOCK_SWITCHES;
	return ENV_MANIFEST
		.filter((entry) =>
			entry.status === "live" && entry.reader === "app" && entry.kind === "gate" &&
			!mock.includes(entry.name)
		)
		.map((entry) => entry.name);
}

/**
 * Whether `name` is a scheduler bearer: a `*_CRON_SECRET`, or `COMMS_DISPATCH_SECRET`, which the
 * dispatch trigger presents the same way. Each must be at least 32 characters (`core/bearer.ts`).
 */
export function isSchedulerBearer(name: string): boolean {
	return /_CRON_SECRET$/.test(name) || name === "COMMS_DISPATCH_SECRET";
}
// #endregion
