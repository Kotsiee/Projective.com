/**
 * data-source.ts — the one place to ask "is this domain reading the database, the fixtures, or
 * nothing at all?"
 *
 * ## Why this exists
 *
 * The answer is computable from the `isXBackendLive()` predicates, each ANDing a per-domain flag with
 * `!useMocks()` and `isSupabaseConfigured()`. What they lack is a way to ask WITHOUT knowing which
 * predicate governs which surface, which is what a diagnostic, a dev panel, a seed script or a
 * developer working out why a page shows fixture data needs. So this is a resolver over the registry
 * ({@link MOCK_REGISTRY}), not a replacement for the predicates: services keep calling their own, and
 * nothing here changes a branch.
 *
 * ## The reasons a domain is not on the database, told apart
 *
 *  - `mock:forced` — `USE_MOCKS` is on. No domain reaches the database: the client factories refuse.
 *  - `mock:gate-off` — this domain's own `*_BACKEND_LIVE` flag is false.
 *  - `mock:unconfigured` — `SUPABASE_URL`/`SUPABASE_ANON_KEY` are missing, so the predicate degrades
 *    rather than throwing. This is the one that looks like a bug and is not.
 *  - `live` — the gate passes (or the domain has none) and Supabase is configured.
 *
 * Off the database, a domain either has a fixture road (it answers fixtures, or acknowledges and
 * stores nothing) or it does not (it answers its own 503). {@link DataSourceReport.serves} says which,
 * because "mocked" alone hides the difference between a page that shows demo data and one that shows
 * an unavailable state. A gated domain's ungated sub-features ({@link MockDomainInfo.ungated}) read
 * live whatever its gate says; `serves` describes what the gate covers.
 */

import { serverEnv } from "./env.ts";
import { isSupabaseConfigured, useMocks } from "./supabase.ts";
import {
	type BackendGate,
	MOCK_DOMAINS,
	MOCK_REGISTRY,
	type MockDomain,
} from "../mocks/registry.ts";

/** Why a domain is serving what it is serving. */
export type DataSourceStatus =
	| "live"
	| "mock:forced"
	| "mock:gate-off"
	| "mock:unconfigured";

/** What a request to the domain actually gets back. */
export type DataSourceServes = "database" | "fixtures" | "unavailable";

/** The resolved answer for one domain. */
export interface DataSourceReport {
	domain: MockDomain;
	/** Which source the gate resolves to, and why. */
	status: DataSourceStatus;
	/** `true` only for {@link DataSourceStatus} `"live"`. */
	isLive: boolean;
	/** The env flag governing this domain, or `null` for an always-live domain. */
	gate: BackendGate | null;
	/** Whether a real Supabase path exists behind the gate at all (the registry's `liveImplemented`). */
	reachesDatabase: boolean;
	/** Whether the domain has a fixture road when it is off the database. */
	fixtureRoad: boolean;
	/** What the gated part of the domain answers in this environment. */
	serves: DataSourceServes;
}

/** Read one gate's value off the resolved environment. */
function gateValue(gate: BackendGate): boolean {
	const env = serverEnv();
	switch (gate) {
		case "AUTH_BACKEND_LIVE":
			return env.authBackendLive;
		case "EXPLORE_BACKEND_LIVE":
			return env.exploreBackendLive;
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
		case "FILES_BACKEND_LIVE":
			return env.filesBackendLive;
		case "INTEGRATIONS_BACKEND_LIVE":
			return env.integrationsBackendLive;
		case "LOGGING_BACKEND_LIVE":
			return env.loggingBackendLive;
		case "EDITORIAL_BACKEND_LIVE":
			return env.editorialBackendLive;
		case "COMMUNITY_BACKEND_LIVE":
			return env.communityBackendLive;
		case "CONTACT_BACKEND_LIVE":
			return env.contactBackendLive;
	}
}

/** What a request gets back, given where the gate resolved. */
function servesFor(status: DataSourceStatus, reachesDatabase: boolean, fixtureRoad: boolean) {
	if (status === "live") return reachesDatabase ? "database" : "fixtures";
	return fixtureRoad ? "fixtures" : "unavailable";
}

/**
 * Resolve one domain's data source.
 *
 * The order of the checks IS the precedence: the master switch first because it overrides
 * everything, then the domain's own gate, then configuration. Testing configuration first would
 * report `mock:unconfigured` for a domain that is mocked on purpose, which reads as a broken
 * environment rather than a chosen one.
 */
export function resolveDataSource(domain: MockDomain): DataSourceReport {
	const info = MOCK_REGISTRY[domain];
	const status: DataSourceStatus = useMocks()
		? "mock:forced"
		: info.gate && !gateValue(info.gate)
		? "mock:gate-off"
		: !isSupabaseConfigured()
		? "mock:unconfigured"
		: "live";
	return {
		domain,
		status,
		isLive: status === "live",
		gate: info.gate,
		reachesDatabase: info.liveImplemented,
		fixtureRoad: info.fixtureRoad,
		serves: servesFor(status, info.liveImplemented, info.fixtureRoad),
	};
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
 * A human-readable summary of where every domain's data is coming from, for a terminal or a boot log.
 *
 * Every count is computed from the registry and the environment, never written down. It calls out
 * the case that looks like a bug and is not (`mock:unconfigured`), the domains that show their
 * unavailable state rather than fixtures, and a gate that is on over a service with no database path.
 */
export function describeDataSources(): string {
	const reports = resolveAllDataSources();
	const width = Math.max(...reports.map((r) => r.domain.length));
	const lines = reports.map((r) => {
		const info = MOCK_REGISTRY[r.domain];
		const gate = r.gate ?? "always live";
		const note = r.isLive && !r.reachesDatabase
			? "  <- gate is ON but this service has no database path; still serving fixtures"
			: !r.isLive && info.ungated.length > 0 && r.status === "mock:gate-off"
			? `  (${info.ungated.length} ungated sub-feature(s) still read live)`
			: "";
		return `  ${r.domain.padEnd(width)}  ${r.status.padEnd(18)} ${
			r.serves.padEnd(11)
		} (${gate})${note}`;
	});
	const count = (serves: DataSourceServes) => reports.filter((r) => r.serves === serves).length;
	const gated = reports.filter((r) => r.gate).length;
	const header = [
		useMocks()
			? `USE_MOCKS is ON - no domain reaches the database.`
			: `${count("database")} of ${reports.length} domains resolve to the database.`,
		`${count("fixtures")} serve fixtures, ${
			count("unavailable")
		} answer their unavailable state; ` +
		`${gated} are behind a gate, ${reports.length - gated} are always live.`,
	];
	return [...header, ...lines].join("\n");
}

// #region CLI
/**
 * `deno run --allow-env --allow-read packages/backend/core/data-source.ts`, or `npm run data:where`.
 *
 * Answers "am I on the database or on fixtures right now?" without starting the app. It loads
 * `.env.local` then `.env` the way `apps/web/main.ts` does (neither overwrites a variable already set),
 * so it reports what the server would actually resolve rather than what one file says in isolation.
 */
if (import.meta.main) {
	const { load } = await import("@std/dotenv");
	await load({ envPath: ".env.local", export: true });
	await load({ export: true });
	console.log(describeDataSources());
}
// #endregion
