import {
	HANDLED_STRIPE_EVENTS,
	HANDLED_STRIPE_THIN_EVENTS,
	PLATFORM_BASE_CURRENCY,
	SETTLEMENT_CURRENCIES,
} from "@projective/types/finance";
import { type Stripe, STRIPE_API_VERSION, type StripeMode } from "../../core/stripe.ts";

/**
 * stripe-preflight.ts — the read-only proof that a Stripe account is configured the way the code
 * expects (PRD-F17, MONEY_BUILD_PROMPTS MR6). `deno task stripe:preflight` (`scripts/stripe-preflight.ts`)
 * runs it; the go-live runbook that a human follows around it is SYSTEM_ARCHITECTURE §Stripe 1.4.
 *
 * ## Shape
 *
 * - A **read-only port** ({@link StripePreflightPort}): five reads, each a `GET`. Nothing here creates,
 *   updates or deletes anything at Stripe — activating the account, adding bank accounts and creating
 *   event destinations are a human's acts.
 * - **Pure checks** ({@link evaluatePreflight}) over what the port read, so every rule is testable with
 *   a fixture port and no network.
 * - A **report** of `pass` / `fail` / `warn` checks, each failure with the one line that fixes it. No
 *   secret is ever placed in it: ids are masked ({@link maskId}) and every Stripe error message is
 *   redacted ({@link redactSecrets}) before it becomes a detail.
 *
 * What the code expects is read from the code, never restated: the event lists are
 * `HANDLED_STRIPE_EVENTS` / `HANDLED_STRIPE_THIN_EVENTS` (`@projective/types/finance`), so an event a
 * later change adds is expected here without an edit; the API version is `STRIPE_API_VERSION`; the
 * settlement currencies are `SETTLEMENT_CURRENCIES` (Decision #423 (B)).
 */

// #region Expectations
/** The platform account's country (Decision #423 (B): "the nine currencies a GB platform can hold"). */
export const PLATFORM_COUNTRY = "GB";

/** The snapshot endpoint's path — `apps/web/routes/api/finance/webhooks/stripe.ts`. */
export const STRIPE_WEBHOOK_PATH = "/api/finance/webhooks/stripe";

/** The Accounts v2 thin-event endpoint's path — `apps/web/routes/api/finance/webhooks/stripe-v2.ts`. */
export const STRIPE_THIN_WEBHOOK_PATH = "/api/finance/webhooks/stripe-v2";

/**
 * The handled events a CONNECTED account emits: its own bank payouts (`payout.*`, planned only with
 * `event.account`, Decision #202) and its status (`account.updated`, which reaches only a destination
 * whose events come from connected accounts — SYSTEM_ARCHITECTURE §Stripe 1.3 step 2). Derived from
 * `HANDLED_STRIPE_EVENTS`, so a new `payout.*` event is expected here too.
 */
export const CONNECT_STRIPE_EVENTS: readonly string[] = HANDLED_STRIPE_EVENTS.filter((type) =>
	type.startsWith("payout.") || type === "account.updated"
);

/** The three event destinations the code reads from, by what each one carries. */
export type DestinationRole = "account" | "connect" | "thin";

/** What one destination role needs at Stripe. */
export interface DestinationRequirement {
	role: DestinationRole;
	/** How the runbook and the report name it. */
	label: string;
	payload: "snapshot" | "thin";
	/** The `events_from` value it must include: the platform's own events, or connected accounts'. */
	scope: "@self" | "@accounts";
	path: string;
	/** Exactly these event types (diffed both ways). */
	events: readonly string[];
	/** The env key that holds its signing secret on the host. */
	secretEnv: string;
}

/** The destination roles, in the order the runbook creates them. */
export const DESTINATION_REQUIREMENTS: readonly DestinationRequirement[] = [
	{
		role: "account",
		label: "account events (snapshot)",
		payload: "snapshot",
		scope: "@self",
		path: STRIPE_WEBHOOK_PATH,
		events: HANDLED_STRIPE_EVENTS,
		secretEnv: "STRIPE_WEBHOOK_SECRET",
	},
	{
		role: "connect",
		label: "connected accounts' events (snapshot)",
		payload: "snapshot",
		scope: "@accounts",
		path: STRIPE_WEBHOOK_PATH,
		events: CONNECT_STRIPE_EVENTS,
		secretEnv: "STRIPE_CONNECT_WEBHOOK_SECRET",
	},
	{
		role: "thin",
		label: "Accounts v2 thin events",
		payload: "thin",
		scope: "@self",
		path: STRIPE_THIN_WEBHOOK_PATH,
		events: HANDLED_STRIPE_THIN_EVENTS,
		secretEnv: "STRIPE_THIN_WEBHOOK_SECRET",
	},
];
// #endregion

// #region Port
/** One v2 event destination (`GET /v2/core/event_destinations?include[]=webhook_endpoint.url`). */
export interface DestinationView {
	id: string;
	/** `webhook_endpoint` · `amazon_eventbridge` · `azure_event_grid`. */
	type: string;
	/** `enabled` · `disabled`. */
	status: string;
	/** `snapshot` · `thin`. */
	payload: string;
	/** `events_from`; empty when Stripe returned null (the destination's own account). */
	eventsFrom: readonly string[];
	/** `snapshot_api_version`; null for a thin destination. */
	apiVersion: string | null;
	/** `webhook_endpoint.url`, or null for another transport. */
	url: string | null;
	enabledEvents: readonly string[];
}

/** One v1 webhook endpoint (`GET /v1/webhook_endpoints`). The v1 object does not say whose events it carries. */
export interface WebhookEndpointView {
	id: string;
	status: string;
	apiVersion: string | null;
	url: string;
	enabledEvents: readonly string[];
}

/** The platform account (`GET /v1/account`). */
export interface PlatformAccountView {
	id: string;
	country: string | null;
	defaultCurrency: string | null;
	detailsSubmitted: boolean;
	chargesEnabled: boolean;
	payoutsEnabled: boolean;
	/** `settings.payouts.schedule.interval`: `manual` · `daily` · `weekly` · `monthly`. */
	payoutInterval: string | null;
}

/** The currencies the platform balance holds (`GET /v1/balance`, available ∪ pending). */
export interface BalanceView {
	currencies: readonly string[];
}

/** One connected account's payout schedule (`GET /v1/accounts`, `settings.payouts.schedule.interval`). */
export interface ConnectedAccountView {
	id: string;
	payoutInterval: string | null;
}

/** The first page of connected accounts. */
export interface ConnectedAccountSample {
	accounts: readonly ConnectedAccountView[];
	/** More accounts exist than were read. */
	hasMore: boolean;
}

/**
 * Everything the preflight reads from Stripe. READ-ONLY by contract: every method is one `GET` (or a
 * paginated run of them). A fixture implements it in the tests; {@link stripePreflightPort} binds it to
 * the SDK.
 */
export interface StripePreflightPort {
	listEventDestinations(): Promise<readonly DestinationView[]>;
	listWebhookEndpoints(): Promise<readonly WebhookEndpointView[]>;
	retrievePlatformAccount(): Promise<PlatformAccountView>;
	retrieveBalance(): Promise<BalanceView>;
	sampleConnectedAccounts(): Promise<ConnectedAccountSample>;
}

/** How many destinations, endpoints or connected accounts one read takes at most. */
const READ_LIMIT = 100;

/**
 * Bind the port to a Stripe client. Only list / retrieve calls (Stripe API reference: List Event
 * Destinations, List all webhook endpoints, Retrieve account, Retrieve balance, List all connected
 * accounts). A restricted key needs Read on each of those resources and nothing else.
 */
export function stripePreflightPort(stripe: Stripe): StripePreflightPort {
	return {
		async listEventDestinations() {
			const rows = await stripe.v2.core.eventDestinations
				.list({ include: ["webhook_endpoint.url"] })
				.autoPagingToArray({ limit: READ_LIMIT });
			return rows.map((d) => ({
				id: d.id,
				type: d.type,
				status: d.status,
				payload: d.event_payload,
				eventsFrom: d.events_from ?? [],
				apiVersion: d.snapshot_api_version ?? null,
				url: d.webhook_endpoint?.url ?? null,
				enabledEvents: d.enabled_events,
			}));
		},
		async listWebhookEndpoints() {
			const rows = await stripe.webhookEndpoints.list({ limit: READ_LIMIT }).autoPagingToArray({
				limit: READ_LIMIT,
			});
			return rows.map((e) => ({
				id: e.id,
				status: e.status,
				apiVersion: e.api_version ?? null,
				url: e.url,
				enabledEvents: e.enabled_events,
			}));
		},
		async retrievePlatformAccount() {
			const a = await stripe.accounts.retrieve(null);
			return {
				id: a.id,
				country: a.country ?? null,
				defaultCurrency: a.default_currency ?? null,
				detailsSubmitted: a.details_submitted === true,
				chargesEnabled: a.charges_enabled === true,
				payoutsEnabled: a.payouts_enabled === true,
				payoutInterval: a.settings?.payouts?.schedule?.interval ?? null,
			};
		},
		async retrieveBalance() {
			const b = await stripe.balance.retrieve();
			return { currencies: [...b.available, ...b.pending].map((x) => x.currency) };
		},
		async sampleConnectedAccounts() {
			const page = await stripe.accounts.list({ limit: READ_LIMIT });
			return {
				accounts: page.data.map((a) => ({
					id: a.id,
					payoutInterval: a.settings?.payouts?.schedule?.interval ?? null,
				})),
				hasMore: page.has_more,
			};
		},
	};
}
// #endregion

// #region Report
export type PreflightStatus = "pass" | "fail" | "warn";

/** The report's sections, in print order. */
export type PreflightGroup = "environment" | "destinations" | "platform" | "balance" | "connect";

export const PREFLIGHT_GROUPS: readonly PreflightGroup[] = [
	"environment",
	"destinations",
	"platform",
	"balance",
	"connect",
];

/** One check. A failure always carries the line that fixes it. */
export interface PreflightCheck {
	group: PreflightGroup;
	name: string;
	status: PreflightStatus;
	/** What was found. Masked and redacted. */
	detail?: string;
	/** What a human does to fix it. */
	fix?: string;
}

/** The whole run. `ok` is false when any check failed; a warning never fails the run. */
export interface PreflightReport {
	mode: StripeMode;
	/** The platform account, masked; null when it could not be read. */
	account: string | null;
	checks: PreflightCheck[];
	failed: number;
	warned: number;
	ok: boolean;
	/** What each destination must be, printed by the script whenever a destination check fails. */
	requirements: readonly DestinationRequirement[];
}

/** What the host running the preflight is configured with. Booleans only — never a secret's value. */
export interface PreflightContext {
	mode: StripeMode;
	/** `DENO_ENV` as the server reads it (`serverEnv().appEnv`). */
	appEnv: string;
	appUrl: string;
	/** `FINANCE_BACKEND_LIVE`. */
	financeLive: boolean;
	/** Each env value is present and shaped like its key (`core/stripe.ts` `parseStripeSettings`). */
	secrets: { webhook: boolean; thin: boolean; connect: boolean; publishable: boolean };
}

/** One port read: its value, or the redacted reason it failed. */
export type PreflightRead<T> = { ok: true; value: T } | { ok: false; error: string };

/** What the port returned, read by read. */
export interface PreflightSnapshot {
	destinations: PreflightRead<readonly DestinationView[]>;
	endpoints: PreflightRead<readonly WebhookEndpointView[]>;
	platform: PreflightRead<PlatformAccountView>;
	balance: PreflightRead<BalanceView>;
	connected: PreflightRead<ConnectedAccountSample>;
}
// #endregion

// #region Masking
const SECRET_RE = /\b(?:sk|rk|pk)_(?:test|live)_[A-Za-z0-9*]+|\bwhsec_[A-Za-z0-9+/=*]+/g;

/** Replace anything shaped like a Stripe key or signing secret with `[redacted]`. */
export function redactSecrets(text: string): string {
	return text.replace(SECRET_RE, "[redacted]");
}

/** `acct_1ABCDEFGH` → `acct_…EFGH`, `ed_test_61RM…JJh1` → `ed_test_…JJh1`. */
export function maskId(id: string): string {
	const match = /^([a-z]+_(?:test_|live_)?)(.*)$/.exec(id);
	const [prefix, rest] = match ? [match[1], match[2]] : ["", id];
	return rest.length > 4 ? `${prefix}…${rest.slice(-4)}` : `${prefix}…`;
}

function describeError(error: unknown): string {
	const e = error as { type?: unknown; code?: unknown; statusCode?: unknown; message?: unknown };
	const head = [e?.type, e?.code, e?.statusCode].filter((x) =>
		typeof x === "string" || typeof x === "number"
	)
		.join(" ");
	const message = typeof e?.message === "string" ? e.message : String(error);
	return redactSecrets(head ? `${head}: ${message}` : message);
}

async function read<T>(call: () => Promise<T>): Promise<PreflightRead<T>> {
	try {
		return { ok: true, value: await call() };
	} catch (error) {
		return { ok: false, error: describeError(error) };
	}
}
// #endregion

// #region Checks
function origin(url: string): string | null {
	try {
		return new URL(url).origin;
	} catch {
		return null;
	}
}

function pathOf(url: string | null): string | null {
	if (!url) return null;
	try {
		return new URL(url).pathname;
	} catch {
		return null;
	}
}

/** `events_from` as the dahlia strings; the pre-2026-03-25 enum values are mapped, null is the own account. */
function scopesOf(d: DestinationView): string[] {
	const raw = d.eventsFrom.length ? d.eventsFrom : ["@self"];
	return raw.map((s) => s === "self" ? "@self" : s === "other_accounts" ? "@accounts" : s);
}

/** The roles a destination serves: right transport, payload, scope and path. Its host is checked apart. */
export function rolesServed(d: DestinationView): DestinationRole[] {
	if (d.type !== "webhook_endpoint") return [];
	const path = pathOf(d.url);
	const scopes = scopesOf(d);
	return DESTINATION_REQUIREMENTS
		.filter((r) => r.payload === d.payload && r.path === path && scopes.includes(r.scope))
		.map((r) => r.role);
}

function listed(items: readonly string[]): string {
	return items.length ? items.join(", ") : "none";
}

function requirementOf(role: DestinationRole): DestinationRequirement {
	return DESTINATION_REQUIREMENTS.find((r) => r.role === role)!;
}

function createFix(r: DestinationRequirement, appOrigin: string): string {
	const version = r.payload === "snapshot" ? `, API version ${STRIPE_API_VERSION}` : "";
	const from = r.scope === "@self" ? "your account" : "connected accounts";
	return `Create it in Workbench → Webhooks: ${r.payload} payload, events from ${from}, URL ${appOrigin}${r.path}${version}, ` +
		`the ${r.events.length} events listed under "What the code expects"; store its signing secret as ${r.secretEnv}.`;
}

function environmentChecks(
	ctx: PreflightContext,
	connectSeparate: boolean | null,
): PreflightCheck[] {
	const group = "environment" as const;
	const out: PreflightCheck[] = [];
	out.push(
		ctx.financeLive
			? { group, name: "payments are switched on (FINANCE_BACKEND_LIVE)", status: "pass" }
			: {
				group,
				name: "payments are switched on (FINANCE_BACKEND_LIVE)",
				status: "fail",
				detail: "off: every Stripe route answers 503",
				fix: "Set FINANCE_BACKEND_LIVE=true on this host.",
			},
	);
	if (ctx.appEnv === "production") {
		out.push(
			ctx.mode === "live" ? { group, name: "production runs a live key", status: "pass" } : {
				group,
				name: "production runs a live key",
				status: "fail",
				detail: "DENO_ENV=production with a TEST key: no real money can move",
				fix:
					"Store the live key (sk_live_/rk_live_) as STRIPE_SECRET_KEY in the host's secret store.",
			},
		);
	}
	const appOrigin = origin(ctx.appUrl);
	if (!appOrigin) {
		out.push({
			group,
			name: "APP_URL is a URL",
			status: "fail",
			detail: "unparseable",
			fix: "Set APP_URL to the public origin, e.g. https://projective.example.",
		});
	} else if (ctx.mode === "live" && !appOrigin.startsWith("https://")) {
		out.push({
			group,
			name: "APP_URL is https in live mode",
			status: "fail",
			detail: appOrigin,
			fix: "Live event destinations need HTTPS: set APP_URL to the https origin.",
		});
	}
	const secret = (name: string, present: boolean, why: string): PreflightCheck =>
		present ? { group, name: `${name} is set`, status: "pass" } : {
			group,
			name: `${name} is set`,
			status: "fail",
			detail: "absent or not shaped like its key",
			fix: `Store ${why} as ${name} in the host's secret store (never in git).`,
		};
	out.push(
		secret(
			"STRIPE_WEBHOOK_SECRET",
			ctx.secrets.webhook,
			"the account destination's signing secret",
		),
	);
	out.push(
		secret("STRIPE_THIN_WEBHOOK_SECRET", ctx.secrets.thin, "the thin destination's signing secret"),
	);
	if (connectSeparate === false) {
		out.push({
			group,
			name: "STRIPE_CONNECT_WEBHOOK_SECRET is set",
			status: "pass",
			detail: "not needed: the account destination also carries connected accounts' events",
		});
	} else {
		out.push(
			secret(
				"STRIPE_CONNECT_WEBHOOK_SECRET",
				ctx.secrets.connect,
				"the Connect destination's signing secret",
			),
		);
	}
	out.push(
		secret(
			"NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY",
			ctx.secrets.publishable,
			`the ${ctx.mode} publishable key (pk_${ctx.mode}_, the same mode as the secret key)`,
		),
	);
	return out;
}

function destinationChecks(
	snapshot: PreflightSnapshot,
	ctx: PreflightContext,
): { checks: PreflightCheck[]; connectSeparate: boolean | null } {
	const group = "destinations" as const;
	if (!snapshot.destinations.ok) {
		return {
			connectSeparate: null,
			checks: [{
				group,
				name: "event destinations are readable",
				status: "fail",
				detail: snapshot.destinations.error,
				fix:
					"Run with a key that has Read on Webhook Endpoints / Event Destinations (STRIPE_PREFLIGHT_KEY).",
			}],
		};
	}
	const appOrigin = origin(ctx.appUrl) ?? ctx.appUrl;
	const destinations = snapshot.destinations.value;
	const checks: PreflightCheck[] = [];
	const served = new Map(destinations.map((d) => [d.id, rolesServed(d)] as const));

	for (const r of DESTINATION_REQUIREMENTS) {
		const candidates = destinations.filter((d) => served.get(d.id)!.includes(r.role));
		const name = `one destination carries ${r.label}`;
		if (candidates.length === 1) {
			checks.push({ group, name, status: "pass", detail: maskId(candidates[0].id) });
		} else if (candidates.length === 0) {
			checks.push({ group, name, status: "fail", detail: "none", fix: createFix(r, appOrigin) });
		} else {
			checks.push({
				group,
				name,
				status: "fail",
				detail: `${candidates.length}: ${candidates.map((d) => maskId(d.id)).join(", ")}`,
				fix:
					"Keep one. A second delivers every event twice, signed with a secret this host may not hold.",
			});
		}
	}

	for (const d of destinations) {
		const roles = served.get(d.id)!;
		const path = pathOf(d.url);
		const ours = path === STRIPE_WEBHOOK_PATH || path === STRIPE_THIN_WEBHOOK_PATH;
		if (roles.length === 0) {
			if (ours) {
				checks.push({
					group,
					name: `${maskId(d.id)} at ${path} carries nothing the code reads`,
					status: "fail",
					detail: `${d.payload} payload, events from ${listed(scopesOf(d))}`,
					fix:
						`Delete it, or recreate it as one of the destinations under "What the code expects".`,
				});
			}
			continue;
		}
		const label = `${maskId(d.id)} (${roles.join(" + ")})`;
		const expectedOrigin = origin(ctx.appUrl);
		const actualOrigin = d.url ? origin(d.url) : null;
		checks.push(
			expectedOrigin && actualOrigin === expectedOrigin
				? {
					group,
					name: `${label}: URL is on APP_URL's host`,
					status: "pass",
					detail: `${actualOrigin}${path}`,
				}
				: {
					group,
					name: `${label}: URL is on APP_URL's host`,
					status: "fail",
					detail: `${actualOrigin ?? "unreadable"}${path ?? ""}, APP_URL is ${
						expectedOrigin ?? ctx.appUrl
					}`,
					fix: `Point it at ${appOrigin}${
						path ?? ""
					} (a destination's URL can be edited in Workbench).`,
				},
		);
		checks.push(
			d.status === "enabled" ? { group, name: `${label}: enabled`, status: "pass" } : {
				group,
				name: `${label}: enabled`,
				status: "fail",
				detail: d.status,
				fix:
					"Enable it in Workbench → Webhooks; then resend what it missed (stripe events resend).",
			},
		);
		if (d.payload === "snapshot") {
			checks.push(
				d.apiVersion === STRIPE_API_VERSION
					? { group, name: `${label}: API version`, status: "pass", detail: d.apiVersion }
					: {
						group,
						name: `${label}: API version`,
						status: "fail",
						detail: `${
							d.apiVersion ?? "the account default"
						}, the code reads ${STRIPE_API_VERSION}`,
						fix:
							`A destination's version cannot be changed: create a new one on ${STRIPE_API_VERSION} and delete this one.`,
					},
			);
		}
		const expected = new Set(roles.flatMap((role) => requirementOf(role).events));
		const enabled = new Set(d.enabledEvents);
		const missing = [...expected].filter((t) => !enabled.has(t));
		const extra = [...enabled].filter((t) => !expected.has(t));
		checks.push(
			missing.length === 0 && extra.length === 0
				? {
					group,
					name: `${label}: events`,
					status: "pass",
					detail: `${expected.size} events, exactly`,
				}
				: {
					group,
					name: `${label}: events`,
					status: "fail",
					detail: `missing: ${listed(missing)} · extra: ${listed(extra)}`,
					fix: enabled.has("*")
						? "Replace '*' with exactly the listed events."
						: "Edit its events in Workbench to exactly the listed set: a missing one never arrives; an extra one is acknowledged and ignored, a wasted delivery.",
				},
		);
	}

	if (snapshot.endpoints.ok) {
		const key = (url: string | null, events: readonly string[]) =>
			`${url ?? ""}|${[...events].sort().join(",")}`;
		const known = new Set(destinations.map((d) => key(d.url, d.enabledEvents)));
		for (const e of snapshot.endpoints.value) {
			const path = pathOf(e.url);
			if (path !== STRIPE_WEBHOOK_PATH && path !== STRIPE_THIN_WEBHOOK_PATH) continue;
			if (known.has(key(e.url, e.enabledEvents))) continue;
			checks.push({
				group,
				name: `v1 webhook endpoint ${maskId(e.id)} is visible as an event destination`,
				status: "warn",
				detail: `${
					origin(e.url) ?? e.url
				}${path}: the v1 object does not say whose events it carries`,
				fix:
					"Recreate it as an event destination in Workbench → Webhooks so the preflight can check it.",
			});
		}
	}

	const connect = destinations.filter((d) => served.get(d.id)!.includes("connect"));
	const connectSeparate = connect.length === 1
		? !served.get(connect[0].id)!.includes("account")
		: null;
	return { checks, connectSeparate };
}

function platformChecks(snapshot: PreflightSnapshot): PreflightCheck[] {
	const group = "platform" as const;
	if (!snapshot.platform.ok) {
		return [{
			group,
			name: "the platform account is readable",
			status: "fail",
			detail: snapshot.platform.error,
			fix: "Run with a key that has Read on the Account (STRIPE_PREFLIGHT_KEY).",
		}];
	}
	const a = snapshot.platform.value;
	const out: PreflightCheck[] = [];
	out.push(
		a.country === PLATFORM_COUNTRY
			? { group, name: "country", status: "pass", detail: a.country }
			: {
				group,
				name: "country",
				status: "fail",
				detail: `${
					a.country ?? "unset"
				}, the settlement currencies assume ${PLATFORM_COUNTRY} (#423 (B))`,
				fix:
					"A Stripe account's country cannot change: use the GB account, or re-rule #423 (B) first.",
			},
	);
	const base = PLATFORM_BASE_CURRENCY.toLowerCase();
	out.push(
		a.defaultCurrency?.toLowerCase() === base
			? { group, name: "default currency", status: "pass", detail: base }
			: {
				group,
				name: "default currency",
				status: "fail",
				detail: `${a.defaultCurrency ?? "unset"}, the platform base is ${base}`,
				fix:
					`Make the ${PLATFORM_BASE_CURRENCY} bank account the default settlement currency (Dashboard → Settings → Bank accounts and currencies).`,
			},
	);
	const off = [
		!a.detailsSubmitted && "details_submitted",
		!a.chargesEnabled && "charges_enabled",
		!a.payoutsEnabled && "payouts_enabled",
	].filter((x): x is string => !!x);
	out.push(
		off.length === 0 ? { group, name: "activated (details, charges, payouts)", status: "pass" } : {
			group,
			name: "activated (details, charges, payouts)",
			status: "fail",
			detail: `false: ${off.join(", ")}`,
			fix:
				"Finish activation in the Dashboard (runbook step 1); Stripe sets these when it has verified the business.",
		},
	);
	out.push(
		a.payoutInterval === "manual"
			? { group, name: "the platform's own payouts are manual", status: "pass" }
			: {
				group,
				name: "the platform's own payouts are manual",
				status: "fail",
				detail: `${
					a.payoutInterval ?? "unreadable"
				}: an automatic schedule pays the available balance, which holds escrow, to the platform's bank`,
				fix:
					"Set the platform's payout schedule to manual (Dashboard → Settings → Payouts), or Transfers fail balance_insufficient (Decision #476).",
			},
	);
	return out;
}

function balanceChecks(snapshot: PreflightSnapshot): PreflightCheck[] {
	const group = "balance" as const;
	const name = "the balance holds every settlement currency";
	if (!snapshot.balance.ok) {
		return [{
			group,
			name: "the balance is readable",
			status: "fail",
			detail: snapshot.balance.error,
			fix: "Run with a key that has Read on Balance (STRIPE_PREFLIGHT_KEY).",
		}];
	}
	const held = new Set(snapshot.balance.value.currencies.map((c) => c.toUpperCase()));
	const missing = SETTLEMENT_CURRENCIES.filter((c) => !held.has(c));
	return [
		missing.length === 0
			? { group, name, status: "pass", detail: SETTLEMENT_CURRENCIES.join(" ") }
			: {
				group,
				name,
				status: "fail",
				detail: `holds ${listed([...held].sort())}; missing ${missing.join(", ")}`,
				fix:
					`Add a bank account in each missing currency (Dashboard → Settings → Bank accounts and currencies, #423 (B)). ` +
					`Until one exists, Stripe converts that currency's charges into the default currency.`,
			},
	];
}

function connectChecks(snapshot: PreflightSnapshot): PreflightCheck[] {
	const group = "connect" as const;
	if (!snapshot.connected.ok) {
		return [{
			group,
			name: "connected accounts are readable",
			status: "fail",
			detail: snapshot.connected.error,
			fix:
				"Enable Connect on the platform, and run with a key that has Read on Connect accounts (STRIPE_PREFLIGHT_KEY).",
		}];
	}
	const { accounts, hasMore } = snapshot.connected.value;
	const name = "connected accounts pay out automatically";
	if (accounts.length === 0) {
		return [{
			group,
			name,
			status: "pass",
			detail: "no connected accounts yet; the default for new ones is a runbook line",
		}];
	}
	const manual = accounts.filter((a) => a.payoutInterval === "manual");
	const sampled = `${accounts.length}${hasMore ? ` (the first ${accounts.length})` : ""} read`;
	return [
		manual.length === 0 ? { group, name, status: "pass", detail: `${sampled}, none manual` } : {
			group,
			name,
			status: "fail",
			detail: `${sampled}; manual: ${manual.map((a) => maskId(a.id)).join(", ")}`,
			fix:
				"Set them to an automatic schedule: Stripe lists a bank payout's balance transactions for automatic payouts only, so their payout.paid is unmatched (Decision #202 (d)).",
		},
	];
}

/**
 * Judge what the port read. Pure: the same snapshot and context always give the same report, and
 * nothing here reaches the network or the environment.
 */
export function evaluatePreflight(
	snapshot: PreflightSnapshot,
	ctx: PreflightContext,
): PreflightReport {
	const destinations = destinationChecks(snapshot, ctx);
	const checks = [
		...environmentChecks(ctx, destinations.connectSeparate),
		...destinations.checks,
		...platformChecks(snapshot),
		...balanceChecks(snapshot),
		...connectChecks(snapshot),
	].map((c) => ({
		...c,
		...(c.detail === undefined ? {} : { detail: redactSecrets(c.detail) }),
	}));
	const failed = checks.filter((c) => c.status === "fail").length;
	return {
		mode: ctx.mode,
		account: snapshot.platform.ok ? maskId(snapshot.platform.value.id) : null,
		checks,
		failed,
		warned: checks.filter((c) => c.status === "warn").length,
		ok: failed === 0,
		requirements: DESTINATION_REQUIREMENTS,
	};
}

/** Read everything through the port (each read independent, so one refusal fails only its own checks), then judge it. */
export async function runStripePreflight(
	port: StripePreflightPort,
	ctx: PreflightContext,
): Promise<PreflightReport> {
	const [destinations, endpoints, platform, balance, connected] = await Promise.all([
		read(() => port.listEventDestinations()),
		read(() => port.listWebhookEndpoints()),
		read(() => port.retrievePlatformAccount()),
		read(() => port.retrieveBalance()),
		read(() => port.sampleConnectedAccounts()),
	]);
	return evaluatePreflight({ destinations, endpoints, platform, balance, connected }, ctx);
}
// #endregion
