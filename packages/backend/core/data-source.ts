/**
 * data-source.ts — the one place to ask "is this domain reading the database or the fixtures?"
 *
 * ## Why this exists
 *
 * The answer was already computable before this module: thirteen `isXBackendLive()` predicates, each
 * ANDing a per-domain flag with `isSupabaseConfigured()`, one of them living in a different file from
 * the other twelve. What was missing was a way to ask the question WITHOUT knowing which predicate
 * governs which surface — which is exactly what a diagnostic, a dev panel, a seed script or a
 * developer trying to work out why a page shows fixture data actually needs.
 *
 * So this is a resolver over the existing predicates, not a replacement for them. Services keep
 * calling their own `isXBackendLive()`; nothing here changes a single branch. The value is that
 * `resolveDataSource("catalogue")` is answerable from a domain name alone.
 *
 * ## The three reasons a domain serves fixtures, told apart
 *
 * Collapsing them into one boolean is what makes this confusing to debug in the first place, so
 * {@link DataSourceStatus} keeps them distinct:
 *
 *  - `mock:forced` — the master `USE_MOCKS` switch is on. Everything is mocked, deliberately.
 *  - `mock:gate-off` — this domain's own `*_BACKEND_LIVE` flag is false. The default for all thirteen.
 *  - `mock:unconfigured` — the flag is on but `SUPABASE_URL`/`SUPABASE_ANON_KEY` are missing, so the
 *    predicate degrades rather than throwing. This is the one that looks like a bug and is not.
 *  - `live` — the predicate passes.
 *
 * ## The uncomfortable part: `live` does not mean a database is being read
 *
 * `reachesDatabase` is deliberately separate from `status`. Seventeen of the twenty fat services
 * contain no Supabase call at all — their live branch is a comment followed by a fall-through to the
 * same fixtures — so a domain can report `live` and still serve fixture data. That is a property of
 * the SERVICE, not of the environment, which is why no amount of env inspection can reveal it and why
 * it is carried in {@link MOCK_REGISTRY} as `liveImplemented` instead.
 *
 * Reporting `live` while returning fixtures would be the most misleading thing this module could do,
 * so it reports both and {@link describeDataSources} prints the disagreement explicitly.
 */

import { serverEnv } from "./env.ts";
import { isSupabaseConfigured, useMocks } from "./supabase.ts";
import { MOCK_DOMAINS, MOCK_REGISTRY, type MockDomain } from "../mocks/registry.ts";

/** Why a domain is serving what it is serving. */
export type DataSourceStatus =
	| "live"
	| "mock:forced"
	| "mock:gate-off"
	| "mock:unconfigured";

/** The resolved answer for one domain. */
export interface DataSourceReport {
	domain: MockDomain;
	/** Which source the gate resolves to, and why. */
	status: DataSourceStatus;
	/** `true` only for {@link DataSourceStatus} `"live"`. */
	isLive: boolean;
	/** The env flag governing this domain. */
	gate: string;
	/**
	 * Whether a real Supabase path exists behind the gate at all.
	 *
	 * When this is `false`, `status: "live"` still yields fixture data — the service has no other
	 * branch to take. See the module docblock.
	 */
	reachesDatabase: boolean;
}

/** Read one domain's gate value off the resolved environment. */
function gateValue(domain: MockDomain): boolean {
	const env = serverEnv();
	switch (MOCK_REGISTRY[domain].gate) {
		case "AUTH_BACKEND_LIVE":
			return env.authBackendLive;
		case "EXPLORE_BACKEND_LIVE":
			return env.exploreBackendLive;
		case "PROFILE_BACKEND_LIVE":
			return env.profileBackendLive;
		case "PROJECTS_BACKEND_LIVE":
			return env.projectsBackendLive;
		case "MESSAGING_BACKEND_LIVE":
			return env.messagingBackendLive;
		case "CATALOGUE_BACKEND_LIVE":
			return env.catalogueBackendLive;
		case "NEWSLETTER_BACKEND_LIVE":
			return env.newsletterBackendLive;
		case "FINANCE_BACKEND_LIVE":
			return env.financeBackendLive;
		case "WORKSPACE_BACKEND_LIVE":
			return env.workspaceBackendLive;
		case "FILES_BACKEND_LIVE":
			return env.filesBackendLive;
		case "INTEGRATIONS_BACKEND_LIVE":
			return env.integrationsBackendLive;
		case "LOGGING_BACKEND_LIVE":
			return env.loggingBackendLive;
	}
}

/**
 * Resolve one domain's data source.
 *
 * The order of the checks IS the precedence and is not arbitrary: the master switch is tested first
 * because it overrides everything, then the domain's own gate, then configuration. Testing
 * configuration first would report `mock:unconfigured` for a domain that is mocked on purpose, which
 * reads as a broken environment rather than a chosen one.
 */
export function resolveDataSource(domain: MockDomain): DataSourceReport {
	const info = MOCK_REGISTRY[domain];
	const base = {
		domain,
		gate: info.gate,
		reachesDatabase: info.liveImplemented,
	};
	if (useMocks()) return { ...base, status: "mock:forced", isLive: false };
	if (!gateValue(domain)) return { ...base, status: "mock:gate-off", isLive: false };
	if (!isSupabaseConfigured()) return { ...base, status: "mock:unconfigured", isLive: false };
	return { ...base, status: "live", isLive: true };
}

/** `true` when {@link resolveDataSource} resolves this domain to the database. */
export function isDomainLive(domain: MockDomain): boolean {
	return resolveDataSource(domain).isLive;
}

/** Resolve every domain at once — for a diagnostics endpoint or a dev panel. */
export function resolveAllDataSources(): readonly DataSourceReport[] {
	return MOCK_DOMAINS.map(resolveDataSource);
}

/**
 * A human-readable summary of where every domain's data is coming from.
 *
 * Written for a terminal or a log line at boot. It calls out the case that looks like a bug and is
 * not (`mock:unconfigured`) and the case that looks fine and is not (`live` over a service with no
 * database path), because those two are the ones that cost time.
 */
export function describeDataSources(): string {
	const reports = resolveAllDataSources();
	const width = Math.max(...reports.map((r) => r.domain.length));
	const lines = reports.map((r) => {
		const flag = !r.isLive
			? ""
			: r.reachesDatabase
			? ""
			: "  <- gate is ON but this service has no database path; still serving fixtures";
		return `  ${r.domain.padEnd(width)}  ${r.status.padEnd(18)} (${r.gate})${flag}`;
	});
	const liveCount = reports.filter((r) => r.isLive).length;
	const header = useMocks()
		? "USE_MOCKS is ON - every domain is serving fixtures."
		: `${liveCount} of ${reports.length} domains resolve to the database.`;
	return [header, ...lines].join("\n");
}

// #region CLI
/**
 * `deno run --allow-env --allow-read packages/backend/core/data-source.ts`, or `npm run data:where`.
 *
 * Answers the one question the two dev scripts raise — "am I on the database or on fixtures right
 * now?" — without starting the app. It loads `.env` the same way `apps/web/main.ts` does, so it
 * reports what the server would actually resolve rather than what the file says in isolation.
 */
if (import.meta.main) {
	const { load } = await import("@std/dotenv");
	await load({ export: true });
	console.log(describeDataSources());
}
// #endregion
