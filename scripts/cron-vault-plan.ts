/**
 * The pure half of `deno task cron:vault` (`scripts/cron-vault.ts`; OPS1, PRD-G6): which Vault
 * secrets the scheduler needs, read from the job registry's own rows; the guards a bearer and
 * `CRON_APP_URL` must pass before anything is written; the SQL the script sends; and the readiness
 * verdict `--check` prints. Nothing here reads a file, the environment, the network or a database,
 * so every rule is unit-tested (`cron-vault-plan.test.ts`).
 *
 * No value reaches a line this module renders. A bearer is reported by its name, its length and
 * whether its sha256 digest equals the env file's, and of `CRON_APP_URL` only the origin is printed,
 * because it is the public `APP_URL`. The check's SQL computes each digest inside the database, so
 * no bearer leaves it.
 */

// #region Registry
/** One `ops.scheduled_jobs` row, as far as Vault is concerned (Decision #203). */
export interface RegistryRow {
	name: string;
	kind: "sql" | "http";
	enabled: boolean;
	/** The bearer's Vault name, which is also the app's env key; `null` on a sql job. */
	secretName: string | null;
}

/** One Vault bearer and the http jobs that send it. */
export interface Bearer {
	name: string;
	/** Every http job that sends it, enabled or not, in name order. */
	jobs: string[];
	/** At least one of those jobs is enabled, so the bearer must be provisioned. */
	required: boolean;
}

/** The Vault name of the origin the database reaches the app on. */
export const APP_URL_SECRET = "CRON_APP_URL";

/**
 * What the default local mode writes besides `CRON_APP_URL`, each only when `.env.local` holds a
 * well-formed one: the integrations jobs (Decision #386), the notification dispatcher (#344 (a)) and
 * the alert sweep (#461). The money sweeps stay on `deno task cron:run`, so a dev server never moves
 * money on a timer; `--all` is the opt-in that writes the rest.
 */
export const LOCAL_DEFAULT_BEARERS = [
	"INTEGRATIONS_CRON_SECRET",
	"COMMS_DISPATCH_SECRET",
	"OPS_CRON_SECRET",
] as const;

/**
 * Every bearer the registry's http jobs send, in name order, each once. A later job needs no edit to
 * the tool: its row names its bearer, and this list grows with it.
 */
export function bearersFromRegistry(rows: readonly RegistryRow[]): Bearer[] {
	const byName = new Map<string, Bearer>();
	for (const row of rows) {
		if (row.kind !== "http" || !row.secretName) continue;
		const bearer = byName.get(row.secretName) ??
			{ name: row.secretName, jobs: [], required: false };
		bearer.jobs.push(row.name);
		bearer.required ||= row.enabled;
		byName.set(row.secretName, bearer);
	}
	return [...byName.values()]
		.map((bearer) => ({ ...bearer, jobs: bearer.jobs.toSorted() }))
		.toSorted((a, b) => a.name.localeCompare(b.name));
}

/** Reads the JSON array `REGISTRY_SQL` returns, refusing anything that is not one. */
export function parseRegistry(json: unknown): RegistryRow[] {
	if (!Array.isArray(json)) throw new Error("the registry query did not return a list");
	return json.map((row) => {
		const r = row as Record<string, unknown>;
		if (
			typeof r.name !== "string" || (r.kind !== "sql" && r.kind !== "http") ||
			typeof r.enabled !== "boolean" ||
			(r.secret_name !== null && typeof r.secret_name !== "string")
		) {
			throw new Error("the registry query returned a malformed row");
		}
		return { name: r.name, kind: r.kind, enabled: r.enabled, secretName: r.secret_name };
	});
}
// #endregion

// #region Value guards
/** The dispatcher's floor and the route's (`ops.fn_dispatch_http_job`, `core/bearer.ts`). */
export const MIN_BEARER_LENGTH = 32;
/** The committed placeholder (`.env.example`); never a value. */
export const PLACEHOLDER = "XXXX-XXXX";

/** Why one value may not be written. */
export type ValueProblem = "missing" | "placeholder" | "whitespace" | "short";

/**
 * The first rule a bearer breaks, or `null`. Length counts characters, as Postgres `length()` does
 * in the dispatcher. Whitespace anywhere is refused rather than trimmed: the dispatcher sends the
 * Vault value untrimmed, so the two stores must hold the same bytes.
 */
export function valueProblem(value: string | undefined): ValueProblem | null {
	if (value === undefined || value === "") return "missing";
	if (value.toUpperCase().includes(PLACEHOLDER)) return "placeholder";
	if (/\s/.test(value)) return "whitespace";
	if ([...value].length < MIN_BEARER_LENGTH) return "short";
	return null;
}

/** One bearer's standing in an env file. */
export interface BearerVerdict {
	name: string;
	problem: ValueProblem | "duplicate" | null;
	/** For a duplicate: the other names holding the same value. */
	sharedWith: string[];
}

/**
 * Vets each named bearer in `env`: the value rules above, then distinctness, because one value
 * behind two names means one leaked bearer opens two routes. Values are compared in memory and
 * never returned.
 */
export function vetBearers(
	names: readonly string[],
	env: Readonly<Record<string, string | undefined>>,
): BearerVerdict[] {
	const verdicts = names.map((name): BearerVerdict => ({
		name,
		problem: valueProblem(env[name]),
		sharedWith: [],
	}));
	const holders = new Map<string, string[]>();
	for (const verdict of verdicts) {
		if (verdict.problem) continue;
		const value = env[verdict.name] as string;
		holders.set(value, [...(holders.get(value) ?? []), verdict.name]);
	}
	for (const verdict of verdicts) {
		if (verdict.problem) continue;
		const shared = holders.get(env[verdict.name] as string) ?? [];
		if (shared.length > 1) {
			verdict.problem = "duplicate";
			verdict.sharedWith = shared.filter((name) => name !== verdict.name);
		}
	}
	return verdicts;
}

/** A verdict as a sentence about `source` (an env file's name), naming no value. */
export function describeVerdict(verdict: BearerVerdict, source: string): string {
	switch (verdict.problem) {
		case "missing":
			return `${source} has no ${verdict.name}`;
		case "placeholder":
			return `${source}'s ${verdict.name} is still the ${PLACEHOLDER} placeholder`;
		case "whitespace":
			return `${source}'s ${verdict.name} contains whitespace`;
		case "short":
			return `${source}'s ${verdict.name} is shorter than ${MIN_BEARER_LENGTH} characters`;
		case "duplicate":
			return `${source}'s ${verdict.name} has the same value as ${verdict.sharedWith.join(", ")}`;
		default:
			return `${source}'s ${verdict.name} is well formed`;
	}
}
// #endregion

// #region CRON_APP_URL guard
/**
 * Where a check or a write points. `local` is the CLI stack's container, which pg_net leaves to reach
 * the dev server on the Docker host. `hosted` is a database reached by connection string, whose app
 * must be the public `APP_URL`.
 */
export type Target =
	| { kind: "local"; port: string | undefined }
	| { kind: "hosted"; appUrl: string | undefined };

/** The local origin: pg_net runs inside the database container, so loopback would be the container. */
export function localAppUrl(port: string | undefined): string {
	return `http://host.docker.internal:${port || "3000"}`;
}

const PRIVATE_SUFFIXES = [".localhost", ".internal", ".local", ".home.arpa"];

function ipv4Private(host: string): boolean {
	const parts = host.split(".").map(Number);
	if (parts.length !== 4 || parts.some((p) => !Number.isInteger(p) || p < 0 || p > 255)) {
		return false;
	}
	const [a, b] = parts;
	return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) ||
		(a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) ||
		(a === 100 && b >= 64 && b <= 127);
}

/**
 * Whether a URL hostname is loopback, private, link-local or a Docker host alias: a name the public
 * internet cannot reach. Literal addresses and reserved names only; no DNS lookup is made.
 */
export function isPrivateHost(hostname: string): boolean {
	const host = hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
	if (host === "" || host === "localhost") return true;
	if (PRIVATE_SUFFIXES.some((suffix) => host.endsWith(suffix))) return true;
	if (ipv4Private(host)) return true;
	if (!host.includes(":")) return false;
	if (host === "::" || host === "::1") return true;
	const mapped = host.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
	if (mapped) return ipv4Private(mapped[1]);
	// The URL parser writes `[::ffff:127.0.0.1]` as `[::ffff:7f00:1]`.
	const hex = host.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
	if (hex) {
		const [high, low] = [parseInt(hex[1], 16), parseInt(hex[2], 16)];
		return ipv4Private(`${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`);
	}
	return /^f[cd]/.test(host) || /^fe[89ab]/.test(host);
}

/** A value's origin for printing, or a phrase that names nothing of the value. */
export function printableOrigin(value: string | null | undefined): string {
	if (!value) return "(unset)";
	try {
		const url = new URL(value);
		return /^https?:$/.test(url.protocol) ? url.origin : "(not an http(s) origin)";
	} catch {
		return "(not an http(s) origin)";
	}
}

/**
 * Why `value` may not be the target's `CRON_APP_URL`, or `null`. Local: exactly
 * `http://host.docker.internal:<PORT>`. Hosted: an https origin (no path, query or credentials) on a
 * public host, equal to `APP_URL`'s origin, so the database calls the same app users reach.
 */
export function appUrlProblem(value: string | null | undefined, target: Target): string | null {
	if (!value) return `${APP_URL_SECRET} is unset`;
	if (target.kind === "local") {
		const expected = localAppUrl(target.port);
		return value === expected ? null : `${APP_URL_SECRET} is not ${expected}`;
	}
	let url: URL;
	try {
		url = new URL(value);
	} catch {
		return `${APP_URL_SECRET} is not a URL`;
	}
	if (url.protocol !== "https:") return `${APP_URL_SECRET} is not https`;
	if (url.username || url.password) return `${APP_URL_SECRET} carries credentials`;
	if (isPrivateHost(url.hostname)) {
		return `${APP_URL_SECRET}'s host ${url.hostname} is loopback, private or a Docker alias`;
	}
	if (url.pathname !== "/" || url.search || url.hash || value.replace(/\/$/, "") !== url.origin) {
		return `${APP_URL_SECRET} is not a bare origin`;
	}
	if (!target.appUrl) return `APP_URL is unset, so ${APP_URL_SECRET} cannot be compared with it`;
	let app: URL;
	try {
		app = new URL(target.appUrl);
	} catch {
		return "APP_URL is not a URL";
	}
	if (app.origin !== url.origin) {
		return `${APP_URL_SECRET} (${url.origin}) is not APP_URL's origin (${app.origin})`;
	}
	return null;
}

/**
 * The `CRON_APP_URL` an env file asks for: its own `CRON_APP_URL`, else `APP_URL`'s origin. Either
 * way `appUrlProblem` then holds it to the hosted rule.
 */
export function hostedAppUrl(
	env: Readonly<Record<string, string | undefined>>,
): string | undefined {
	if (env[APP_URL_SECRET]) return env[APP_URL_SECRET];
	const origin = printableOrigin(env.APP_URL);
	return origin.startsWith("(") ? undefined : origin;
}
// #endregion

// #region Digest compare
/** The lowercase hex sha256 of a value's UTF-8 bytes, as `encode(sha256(convert_to(v, 'UTF8')), 'hex')`. */
export async function sha256Hex(value: string): Promise<string> {
	const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
	return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Whether two hex digests are equal, compared in constant time; an absent side never matches. */
export function sameDigest(a: string | null | undefined, b: string | null | undefined): boolean {
	if (!a || !b || a.length !== b.length) return false;
	let diff = 0;
	for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
	return diff === 0;
}
// #endregion

// #region SQL
/** Which of the objects the check reads exist, so its query never names a missing one. */
export interface Capabilities {
	registry: boolean;
	vault: boolean;
	cron: boolean;
	dispatches: boolean;
}

/** Probes the objects the check needs. */
export const CAPABILITIES_SQL = `SELECT json_build_object(
    'registry', pg_catalog.to_regclass('ops.scheduled_jobs') IS NOT NULL,
    'vault', pg_catalog.to_regclass('vault.decrypted_secrets') IS NOT NULL,
    'cron', pg_catalog.to_regclass('cron.job') IS NOT NULL,
    'dispatches', pg_catalog.to_regclass('ops.http_job_dispatches') IS NOT NULL
)::text;`;

/** Every registry row, as one JSON array. */
export const REGISTRY_SQL = `SELECT COALESCE(json_agg(json_build_object(
    'name', j.name, 'kind', j.kind, 'enabled', j.enabled, 'secret_name', j.secret_name
) ORDER BY j.name), '[]'::json)::text
FROM ops.scheduled_jobs j;`;

/** A Vault row's id by name: the first half of an upsert (`$1` name). */
export const VAULT_ID_SQL = "SELECT s.id::text FROM vault.secrets s WHERE s.name = $1";
/** Replaces a Vault value (`$1` id, `$2` value), as `deno task cron:vault` always has. */
export const VAULT_UPDATE_SQL = "SELECT vault.update_secret($1::uuid, $2)";
/** Creates a Vault value (`$1` value, `$2` name). */
export const VAULT_CREATE_SQL = "SELECT vault.create_secret($1, $2)";

/**
 * The read-only check, one JSON document: `CRON_APP_URL`'s value (public) and, for each enabled http
 * job, whether its bearer is in Vault, its length and sha256 digest computed in the database, the
 * Vault row's `updated_at`, its `cron.job` entry and its last dispatch. Core `sha256()` (Postgres 11+)
 * needs no extension.
 */
export function checkSql(caps: Capabilities): string {
	const vault = caps.vault;
	const secret = vault ? `LEFT JOIN vault.decrypted_secrets s ON s.name = j.secret_name` : "";
	const cron = caps.cron ? `LEFT JOIN cron.job c ON c.jobname = j.name` : "";
	const last = caps.dispatches
		? `(SELECT json_build_object('dispatched_at', d.dispatched_at, 'settled_at', d.settled_at,
                'status_code', d.status_code, 'error', pg_catalog.left(d.error, 200))
              FROM ops.http_job_dispatches d WHERE d.job_name = j.name
             ORDER BY d.dispatched_at DESC LIMIT 1)`
		: "NULL::json";
	return `SELECT json_build_object(
    'app_url', ${
		vault
			? `(SELECT s.decrypted_secret FROM vault.decrypted_secrets s WHERE s.name = '${APP_URL_SECRET}')`
			: "NULL::text"
	},
    'jobs', COALESCE((SELECT json_agg(json_build_object(
        'name', j.name,
        'secret_name', j.secret_name,
        'present', ${vault ? "s.id IS NOT NULL" : "false"},
        'length', ${vault ? "pg_catalog.length(s.decrypted_secret)" : "NULL::integer"},
        'digest', ${
		vault
			? "pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(s.decrypted_secret, 'UTF8')), 'hex')"
			: "NULL::text"
	},
        'secret_updated_at', ${vault ? "s.updated_at" : "NULL::timestamptz"},
        'cron', ${caps.cron ? "c.jobid IS NOT NULL" : "false"},
        'cron_active', ${caps.cron ? "c.active" : "NULL::boolean"},
        'last', ${last}
    ) ORDER BY j.secret_name, j.name)
      FROM ops.scheduled_jobs j
      ${secret}
      ${cron}
     WHERE j.kind = 'http' AND j.enabled), '[]'::json)
)::text;`;
}
// #endregion

// #region Check verdict
/** A job's last dispatch, from `ops.http_job_dispatches`. */
export interface LastDispatch {
	dispatchedAt: string;
	settledAt: string | null;
	statusCode: number | null;
	error: string | null;
}

/** What the check reads back for one enabled http job: digests and lengths, never a value. */
export interface VaultJobState {
	name: string;
	secretName: string;
	present: boolean;
	/** `null` when the row is present and does not decrypt. */
	length: number | null;
	digest: string | null;
	secretUpdatedAt: string | null;
	cron: boolean;
	cronActive: boolean | null;
	last: LastDispatch | null;
}

/** The whole read-back. */
export interface VaultState {
	appUrl: string | null;
	capabilities: Capabilities;
	jobs: VaultJobState[];
}

/** Reads the JSON document `checkSql` returns. */
export function parseVaultState(json: unknown, capabilities: Capabilities): VaultState {
	const doc = json as { app_url?: unknown; jobs?: unknown };
	if (!doc || typeof doc !== "object" || !Array.isArray(doc.jobs)) {
		throw new Error("the check query returned a malformed document");
	}
	const jobs = doc.jobs.map((raw): VaultJobState => {
		const j = raw as Record<string, unknown>;
		const last = j.last as Record<string, unknown> | null;
		return {
			name: String(j.name),
			secretName: String(j.secret_name),
			present: j.present === true,
			length: typeof j.length === "number" ? j.length : null,
			digest: typeof j.digest === "string" ? j.digest : null,
			secretUpdatedAt: typeof j.secret_updated_at === "string" ? j.secret_updated_at : null,
			cron: j.cron === true,
			cronActive: typeof j.cron_active === "boolean" ? j.cron_active : null,
			last: last
				? {
					dispatchedAt: String(last.dispatched_at),
					settledAt: typeof last.settled_at === "string" ? last.settled_at : null,
					statusCode: typeof last.status_code === "number" ? last.status_code : null,
					error: typeof last.error === "string" ? last.error : null,
				}
				: null,
		};
	});
	return {
		appUrl: typeof doc.app_url === "string" ? doc.app_url : null,
		capabilities,
		jobs,
	};
}

/** The env side of one bearer: its digest, or why the env file cannot supply one. */
export interface ExpectedBearer {
	digest: string | null;
	problem: string | null;
}

/** The answers a route gives a bearer it does not accept (Decision #125: 404 unless it matches). */
const REFUSALS = new Set([401, 403, 404]);

/** `2026-11-19T10:15:42.1+00:00` → `2026-11-19 10:15Z`. */
export function shortTime(value: string): string {
	const date = new Date(value);
	return Number.isNaN(date.getTime())
		? value
		: `${date.toISOString().slice(0, 16).replace("T", " ")}Z`;
}

/** A job's last outcome, for the report. */
export function describeLast(last: LastDispatch | null): string {
	if (!last) return "never dispatched";
	if (!last.settledAt) return `dispatched ${shortTime(last.dispatchedAt)}, no answer yet`;
	if (last.error) return `failed ${shortTime(last.dispatchedAt)}: ${last.error.slice(0, 80)}`;
	return `${last.statusCode ?? "no status"} at ${shortTime(last.dispatchedAt)}`;
}

/** Whether a refusal answered a dispatch made after the Vault value was last written. */
function refusedSinceWritten(job: VaultJobState): boolean {
	const last = job.last;
	if (!last || !last.settledAt || last.statusCode === null || !REFUSALS.has(last.statusCode)) {
		return false;
	}
	if (!job.secretUpdatedAt) return false;
	return new Date(last.dispatchedAt).getTime() > new Date(job.secretUpdatedAt).getTime();
}

/** Why one job is not ready, first reason first; empty when it is ready. */
export function jobProblems(
	job: VaultJobState,
	expected: ExpectedBearer | undefined,
	source: string,
	capabilities: Capabilities,
): string[] {
	const problems: string[] = [];
	if (!capabilities.vault) problems.push("Supabase Vault is not installed");
	else if (!job.present) problems.push(`${job.secretName} is not in Vault`);
	else if (job.length === null) problems.push(`${job.secretName} is in Vault but does not decrypt`);
	else if (job.length < MIN_BEARER_LENGTH) {
		problems.push(
			`${job.secretName} is ${job.length} characters in Vault; the dispatcher needs ${MIN_BEARER_LENGTH}`,
		);
	}
	if (!expected || expected.problem) {
		problems.push(expected?.problem ?? `${source} has no ${job.secretName}`);
	} else if (job.present && job.length !== null && !sameDigest(job.digest, expected.digest)) {
		problems.push(`${job.secretName} in Vault differs from ${source}`);
	}
	if (!capabilities.cron) problems.push("pg_cron is not installed, so nothing schedules it");
	else if (!job.cron) problems.push("no cron.job entry");
	else if (job.cronActive === false) problems.push("its cron.job entry is inactive");
	if (refusedSinceWritten(job)) {
		problems.push(
			`the app answered ${job.last?.statusCode} at ${
				shortTime(job.last?.dispatchedAt ?? "")
			}, after the Vault value was written: the app's ${job.secretName} differs, or the route is not deployed`,
		);
	}
	return problems;
}

/** The check's report and verdict. */
export interface CheckResult {
	ready: boolean;
	lines: string[];
}

/**
 * The `--check` verdict: one line for `CRON_APP_URL` and one per enabled http job, each `ready` or
 * `NOT READY` with its reasons and its last outcome, then a summary. Ready means the job's bearer is
 * in Vault, at least 32 characters, digest-equal to `source`, scheduled by pg_cron, and not refused by
 * the app since it was written. A failure of any other kind in the last outcome is reported, not
 * gated on: it is the app's health, not the provisioning's.
 */
export function evaluateCheck(
	state: VaultState,
	expected: ReadonlyMap<string, ExpectedBearer>,
	target: Target,
	source: string,
): CheckResult {
	const lines: string[] = [];
	const urlProblem = state.capabilities.vault
		? appUrlProblem(state.appUrl, target)
		: "Supabase Vault is not installed";
	const urlState = state.appUrl === null && state.capabilities.vault
		? `${APP_URL_SECRET} is not in Vault`
		: urlProblem;
	lines.push(
		urlState
			? `NOT READY  ${APP_URL_SECRET.padEnd(34)} ${urlState}`
			: `ready      ${APP_URL_SECRET.padEnd(34)} ${printableOrigin(state.appUrl)}`,
	);

	const notReady: string[] = [];
	for (const job of state.jobs) {
		const problems = jobProblems(
			job,
			expected.get(job.secretName),
			source,
			state.capabilities,
		);
		const head = `${job.name.padEnd(34)} ${job.secretName.padEnd(26)}`;
		const last = `last: ${describeLast(job.last)}`;
		if (problems.length === 0) {
			lines.push(`ready      ${head} ${last}`);
		} else {
			notReady.push(`${job.name} (${job.secretName})`);
			lines.push(`NOT READY  ${head} ${problems.join("; ")}; ${last}`);
		}
	}

	const total = state.jobs.length;
	const readyJobs = total - notReady.length;
	const ready = !urlState && notReady.length === 0;
	lines.push(
		ready
			? `cron:vault --check: ${APP_URL_SECRET} and ${readyJobs} of ${total} enabled http jobs ready.`
			: `cron:vault --check: NOT READY. ${readyJobs} of ${total} enabled http jobs ready${
				urlState ? `; ${APP_URL_SECRET}: ${urlState}` : ""
			}${notReady.length ? `; not ready: ${notReady.join(", ")}` : ""}.`,
	);
	return { ready, lines };
}
// #endregion

// #region Arguments
/** What one invocation does. */
export type Mode =
	| { kind: "default" }
	| { kind: "all" }
	| { kind: "check-local" }
	| { kind: "write-env"; envFile: string; operatorFile?: string }
	| { kind: "check-env"; envFile: string; operatorFile?: string }
	| { kind: "help" };

/** The usage text. */
export const USAGE = [
	"Usage: deno task cron:vault [--all | --env-file <path> [--operator-file <path>]] [--check]",
	"",
	"  (no flags)              the local container: CRON_APP_URL plus the integrations, dispatcher",
	"                          and alert bearers from .env.local (the db:reset hook; never fails a reset)",
	"  --all                   the local container: every bearer the registry names, money sweeps included",
	"  --env-file <path>       any database: writes CRON_APP_URL and every registry bearer from the env",
	"                          file the app's host receives",
	"  --operator-file <path>  where CRON_VAULT_DB_URL and CRON_VAULT_DB_CA live, kept out of the host's",
	"                          file; without it they are read from the --env-file",
	"  --check                 read-only, with either target: is every enabled http job ready? Exit 1 if not",
	"",
	"No value is ever read from the command line or printed.",
];

/**
 * Parses the command line. An unknown argument is reported by its position, never echoed, because a
 * value pasted onto the command line is exactly what must not reach the output.
 */
export function parseArgs(args: readonly string[]): Mode | { error: string } {
	let all = false;
	let check = false;
	const paths: Record<"--env-file" | "--operator-file", string | undefined> = {
		"--env-file": undefined,
		"--operator-file": undefined,
	};
	for (let i = 0; i < args.length; i++) {
		const arg = args[i];
		if (arg === "--help" || arg === "-h") return { kind: "help" };
		if (arg === "--all") all = true;
		else if (arg === "--check") check = true;
		else if (arg === "--env-file" || arg === "--operator-file") {
			const path = args[i + 1];
			if (!path || path.startsWith("--")) return { error: `${arg} needs a path` };
			if (paths[arg] !== undefined) return { error: `${arg} is given twice` };
			paths[arg] = path;
			i++;
		} else return { error: `argument ${i + 1} is not a flag cron:vault knows` };
	}
	const envFile = paths["--env-file"];
	const operatorFile = paths["--operator-file"];
	if (operatorFile !== undefined && envFile === undefined) {
		return { error: "--operator-file goes with --env-file" };
	}
	if (all && envFile !== undefined) {
		return { error: "--all is local only; drop it with --env-file" };
	}
	if (all && check) return { error: "--check reads; run it without --all" };
	if (envFile !== undefined) {
		const files = operatorFile === undefined ? { envFile } : { envFile, operatorFile };
		return check ? { kind: "check-env", ...files } : { kind: "write-env", ...files };
	}
	if (all) return { kind: "all" };
	return check ? { kind: "check-local" } : { kind: "default" };
}
// #endregion

// #region Connection string
/** The only keys read from an operator file. */
export const OPERATOR_KEYS = ["CRON_VAULT_DB_URL", "CRON_VAULT_DB_CA"] as const;

/** Where the connection string and the CA file path come from. */
export interface ConnectionKeys {
	dbUrl: string | undefined;
	ca: string | undefined;
	/** The file the keys were read from, for messages. */
	source: string;
}

/**
 * The connection keys for an `--env-file` run. With an operator file they are read from it alone,
 * and the env file the app's host receives may hold neither: an operator credential never travels
 * in the host's environment (OPS6's `deploy:check` refuses one there too). Without an operator file
 * both come from the env file, the single-file form. Every other key in an operator file is ignored,
 * so bearers are only ever compared against the values the host receives.
 */
export function connectionKeys(
	env: Readonly<Record<string, string | undefined>>,
	operator: Readonly<Record<string, string | undefined>> | null,
	sources: { env: string; operator?: string },
): ConnectionKeys | { problem: string } {
	if (!operator) {
		return { dbUrl: env.CRON_VAULT_DB_URL, ca: env.CRON_VAULT_DB_CA, source: sources.env };
	}
	const held = OPERATOR_KEYS.filter((key) => {
		const value = env[key];
		return !!value && !value.toUpperCase().includes(PLACEHOLDER);
	});
	if (held.length) {
		return {
			problem: `${sources.env} holds ${held.join(" and ")}, which ${
				held.length > 1 ? "belong" : "belongs"
			} only in ${
				sources.operator ?? "the operator file"
			}: the file a host receives never carries an operator credential`,
		};
	}
	return {
		dbUrl: operator.CRON_VAULT_DB_URL,
		ca: operator.CRON_VAULT_DB_CA,
		source: sources.operator ?? "the operator file",
	};
}

/** A database connection, parsed from `CRON_VAULT_DB_URL`. */
export interface DbConnection {
	hostname: string;
	port: number;
	user: string;
	password: string;
	database: string;
	/** A loopback host: the only kind reached without TLS. */
	loopback: boolean;
	/** `host:port/database`, the only part ever printed. */
	label: string;
}

/**
 * Parses a `postgres://` / `postgresql://` URL. A problem is described without echoing the URL,
 * which carries the password.
 */
export function parseDbUrl(value: string | undefined): DbConnection | { problem: string } {
	if (!value || value.toUpperCase().includes(PLACEHOLDER)) {
		return { problem: "CRON_VAULT_DB_URL is unset" };
	}
	let url: URL;
	try {
		url = new URL(value);
	} catch {
		return { problem: "CRON_VAULT_DB_URL is not a URL" };
	}
	if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
		return { problem: "CRON_VAULT_DB_URL is not a postgres:// URL" };
	}
	if (!url.hostname) return { problem: "CRON_VAULT_DB_URL has no host" };
	if (!url.username) return { problem: "CRON_VAULT_DB_URL has no user" };
	const port = url.port ? Number(url.port) : 5432;
	const database = decodeURIComponent(url.pathname.replace(/^\//, "")) || "postgres";
	const host = url.hostname.replace(/^\[|\]$/g, "");
	const loopback = host === "localhost" || host === "::1" || /^127\./.test(host);
	return {
		hostname: host,
		port,
		user: decodeURIComponent(url.username),
		password: decodeURIComponent(url.password),
		database,
		loopback,
		label: `${url.hostname}:${port}/${database}`,
	};
}
// #endregion

// #region Redaction
/**
 * Replaces every listed secret in a line with `[redacted]`, longest first. Every line the script
 * prints in a mode that holds values passes through it, so not even an error message that quotes a
 * statement or a connection string can carry one out.
 */
export function redactor(secrets: readonly (string | undefined)[]): (line: string) => string {
	const values = [...new Set(secrets.filter((s): s is string => !!s && s.length >= 4))]
		.toSorted((a, b) => b.length - a.length);
	return (line) => values.reduce((out, value) => out.replaceAll(value, "[redacted]"), line);
}
// #endregion
