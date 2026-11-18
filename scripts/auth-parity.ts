/**
 * `deno task auth:parity` proves a hosted Supabase project's GoTrue holds the auth settings that
 * `supabase/config.toml` pins locally (Decisions #449 and #447, PRD-C13–C16). A hosted project
 * never reads `config.toml`, so each setting is pushed or set by hand (SYSTEM_ARCHITECTURE.md
 * §Authentication & Identity, "Hosted auth runbook"), and this is the check that it was.
 *
 * One `GET /v1/projects/{ref}/config/auth` to the Supabase Management API, authorised by a
 * personal access token. The script only ever reads: it writes nothing anywhere. It maps each field
 * to its `config.toml` key and prints `key · local · hosted · ok`. A secret is reported as set or
 * unset (or as one of Cloudflare's published Turnstile test secrets, which a push from a
 * development checkout would carry), never printed. The token never reaches the output: every
 * line is redacted.
 *
 * Inputs: `SUPABASE_PROJECT_REF` and `SUPABASE_ACCESS_TOKEN`, from the shell first, then
 * `.env.local` (§Environment Variable Contract). `--project-ref <ref>` overrides the variable, for
 * a second hosted environment. `--fixture <file>` compares a saved response and touches no network.
 *
 * Exit codes: 0 every key matches · 1 one or more keys drift · 2 cannot run (a missing or
 * placeholder variable, a malformed ref, a refused token, an unreachable API, a response or fixture
 * that is not a JSON object, or a bad argument).
 */
import { parse as parseDotenv } from "@std/dotenv";
import { parse as parseToml } from "@std/toml";

// #region The pinned keys
/** How a hosted value is compared with the local one. */
export type ParityCompare = "value" | "requirements" | "secret";

/** One auth setting `config.toml` pins and the hosted project must hold. */
export interface ParityKey {
	/** Dotted path in `supabase/config.toml`, e.g. `auth.email.secure_password_change`. */
	key: string;
	/** The field of `GET /v1/projects/{ref}/config/auth` that holds it. */
	field: string;
	/** The readiness row and decision that pin it. */
	pin: string;
	compare: ParityCompare;
	/** For a secret: the local key whose `true` makes the secret required. */
	requiredWhen?: string;
	/** Shown beside the local value. */
	note?: string;
}

/**
 * Every auth key the AU2 (`packages/types/auth/gotrue-config.contract.test.ts`) and AU3
 * (`apps/web/features/auth/core/captcha.contract.test.ts`) contract tests pin, plus the two
 * settings C14 and C16 name (Google on, manual linking reviewed and kept) and TOTP, off until MFA1.
 * Field names are the Management API's `AuthConfigResponse` (verified against its OpenAPI
 * document, 2026-11-18).
 */
export const PARITY_KEYS: readonly ParityKey[] = [
	{
		key: "auth.minimum_password_length",
		field: "password_min_length",
		pin: "PRD-C13 · #449",
		compare: "value",
	},
	{
		key: "auth.password_requirements",
		field: "password_required_characters",
		pin: "PRD-C13 · #449",
		compare: "requirements",
	},
	{
		key: "auth.email.secure_password_change",
		field: "security_update_password_require_reauthentication",
		pin: "PRD-C16 · #449",
		compare: "value",
	},
	{
		key: "auth.enable_manual_linking",
		field: "security_manual_linking_enabled",
		pin: "PRD-C16 · #449",
		compare: "value",
	},
	{
		key: "auth.external.google.enabled",
		field: "external_google_enabled",
		pin: "PRD-C14",
		compare: "value",
	},
	{
		key: "auth.external.google.skip_nonce_check",
		field: "external_google_skip_nonce_check",
		pin: "PRD-C14 · #449",
		compare: "value",
	},
	{
		key: "auth.captcha.enabled",
		field: "security_captcha_enabled",
		pin: "PRD-C15 · #447",
		compare: "value",
	},
	{
		key: "auth.captcha.provider",
		field: "security_captcha_provider",
		pin: "PRD-C15 · #447",
		compare: "value",
	},
	{
		key: "auth.captcha.secret",
		field: "security_captcha_secret",
		pin: "PRD-C15 · #447",
		compare: "secret",
		requiredWhen: "auth.captcha.enabled",
	},
	{
		key: "auth.mfa.totp.enroll_enabled",
		field: "mfa_totp_enroll_enabled",
		pin: "PRD-C17 · MFA1",
		compare: "value",
		note: "off until MFA1",
	},
	{
		key: "auth.mfa.totp.verify_enabled",
		field: "mfa_totp_verify_enabled",
		pin: "PRD-C17 · MFA1",
		compare: "value",
		note: "off until MFA1",
	},
];
// #endregion

// #region Value mapping
/**
 * `config.toml` `password_requirements` → the API's `password_required_characters`, the enum's
 * exact strings (sets joined by `:`; the symbol set has its backslash doubled, as the API spells
 * it).
 */
export const REQUIRED_CHARACTERS: Readonly<Record<string, string>> = {
	"": "",
	letters_digits: "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ:0123456789",
	lower_upper_letters_digits: "abcdefghijklmnopqrstuvwxyz:ABCDEFGHIJKLMNOPQRSTUVWXYZ:0123456789",
	lower_upper_letters_digits_symbols:
		"abcdefghijklmnopqrstuvwxyz:ABCDEFGHIJKLMNOPQRSTUVWXYZ:0123456789:!@#$%^&*()_+-=[]{};'\\\\:\"|<>?,./`~",
};

/** The `config.toml` name for an API `password_required_characters` value, or `undefined`. */
export function requirementsName(characters: unknown): string | undefined {
	const value = characters ?? "";
	return Object.entries(REQUIRED_CHARACTERS).find(([, chars]) => chars === value)?.[0];
}

/**
 * Cloudflare's published Turnstile test secrets (always passes · always fails · token already
 * spent) and the SHA-256 hex of each, so either form the API returns is recognised.
 */
export const TURNSTILE_TEST_SECRETS: Readonly<Record<string, string>> = {
	"1x0000000000000000000000000000000AA":
		"fb8f35129df87662c650ada12fd614f1b58dce4a37fdd7589ba3a6b9a78c0aae",
	"2x0000000000000000000000000000000AA":
		"1e3e58656012d861e23deae64f177673d7b86a9c55fe1d5d10b94e3c9755d168",
	"3x0000000000000000000000000000000AA":
		"841b4f5b0b34e19ada74f47a88831efbb909008ceea4430d61449c1874923f83",
};

/** What a hosted secret is, never what it holds. */
export type SecretState = "unset" | "set" | "test secret";

/** Classifies a hosted secret value without exposing it. */
export function secretState(value: unknown): SecretState {
	if (typeof value !== "string" || value.trim() === "") return "unset";
	const trimmed = value.trim();
	const isTest = Object.entries(TURNSTILE_TEST_SECRETS).some(([secret, digest]) =>
		trimmed === secret || trimmed.toLowerCase() === digest
	);
	return isTest ? "test secret" : "set";
}

/** The value at a dotted path of a parsed TOML document, or `undefined`. */
export function lookup(config: Record<string, unknown>, path: string): unknown {
	let node: unknown = config;
	for (const part of path.split(".")) {
		if (!node || typeof node !== "object" || Array.isArray(node)) return undefined;
		node = (node as Record<string, unknown>)[part];
	}
	return node;
}

const ENV_REFERENCE = /^env\([A-Z0-9_]+\)$/;

function show(value: unknown): string {
	if (value === undefined) return "absent";
	if (value === null) return "unset";
	return typeof value === "string" ? (value === "" ? '""' : value) : String(value);
}
// #endregion

// #region Comparison
/** One line of the parity table. */
export interface ParityRow {
	key: string;
	field: string;
	pin: string;
	local: string;
	hosted: string;
	ok: boolean;
	/** What the hosted field must become, for the drift summary. */
	expected: string;
}

function compareKey(
	entry: ParityKey,
	config: Record<string, unknown>,
	hosted: Record<string, unknown>,
): ParityRow {
	const local = lookup(config, entry.key);
	const remote = hosted[entry.field];
	const present = entry.field in hosted;
	const base = { key: entry.key, field: entry.field, pin: entry.pin };
	const noted = (text: string) => entry.note ? `${text} (${entry.note})` : text;

	if (entry.compare === "secret") {
		const required = entry.requiredWhen ? lookup(config, entry.requiredWhen) === true : true;
		const state = present ? secretState(remote) : "absent";
		const localText = typeof local === "string" && ENV_REFERENCE.test(local)
			? local
			: local === undefined
			? "absent"
			: "set";
		return {
			...base,
			local: noted(localText),
			hosted: state === "test secret" ? "set: a Cloudflare test secret" : state,
			ok: required ? state === "set" : true,
			expected: "the environment's own secret (set, not a test secret)",
		};
	}

	if (entry.compare === "requirements") {
		const expectedChars = typeof local === "string" ? REQUIRED_CHARACTERS[local] : undefined;
		const remoteName = present ? requirementsName(remote) : undefined;
		const hostedText = !present
			? "absent"
			: remoteName === undefined
			? "unrecognised value"
			: show(remoteName);
		return {
			...base,
			local: noted(show(local)),
			hosted: hostedText,
			ok: expectedChars !== undefined && present && (remote ?? "") === expectedChars,
			expected: expectedChars === undefined
				? `a known value (config.toml has ${show(local)})`
				: `"${expectedChars}"`,
		};
	}

	const comparable = typeof local === "string" || typeof local === "number" ||
		typeof local === "boolean";
	return {
		...base,
		local: noted(show(local)),
		hosted: present ? show(remote) : "absent",
		ok: comparable && present && remote === local,
		expected: show(local),
	};
}

/** Compares every pinned key of a parsed `config.toml` with a hosted auth config response. */
export function compareAuth(
	config: Record<string, unknown>,
	hosted: Record<string, unknown>,
	keys: readonly ParityKey[] = PARITY_KEYS,
): ParityRow[] {
	return keys.map((entry) => compareKey(entry, config, hosted));
}
// #endregion

// #region Report
/** The aligned `key · local · hosted · ok` table, one string per line. */
export function renderTable(rows: readonly ParityRow[]): string[] {
	const header = { key: "key", local: "local", hosted: "hosted", ok: "ok" };
	const cells = rows.map((row) => ({ ...row, ok: row.ok ? "ok" : "DRIFT" }));
	const width = (pick: (row: typeof header) => string) =>
		Math.max(pick(header).length, ...cells.map(pick).map((cell) => cell.length));
	const keyW = width((row) => row.key);
	const localW = width((row) => row.local);
	const hostedW = width((row) => row.hosted);
	const line = (row: typeof header) =>
		`${row.key.padEnd(keyW)}  ${row.local.padEnd(localW)}  ${
			row.hosted.padEnd(hostedW)
		}  ${row.ok}`;
	return [line(header), ...cells.map(line)];
}

/** The closing lines: a count when clean, else each drifting key with its field and pin. */
export function renderSummary(rows: readonly ParityRow[]): string[] {
	const drift = rows.filter((row) => !row.ok);
	if (drift.length === 0) return [`${rows.length} of ${rows.length} keys match.`];
	return [
		`${drift.length} of ${rows.length} keys drift: ${drift.map((row) => row.key).join(", ")}`,
		...drift.map((row) =>
			`  ${row.key}: set ${row.field} to ${row.expected}; it is ${row.hosted} (${row.pin})`
		),
	];
}
// #endregion

// #region Run
/** The Management API origin. */
export const MANAGEMENT_API = "https://api.supabase.com";

/** A project ref is exactly 20 lowercase letters (the CLI's own rule). */
const PROJECT_REF = /^[a-z]{20}$/;
const PLACEHOLDER = "XXXX-XXXX";

/** What `run` needs from the outside world, injectable so tests touch no network or env. */
export interface ParityDeps {
	args: readonly string[];
	/** Reads one variable (shell first, then `.env.local`); `undefined` when unset. */
	env: (name: string) => string | undefined;
	readText: (path: string | URL) => Promise<string>;
	fetch: typeof fetch;
	print: (line: string) => void;
}

/** Usage text for `--help` and a bad argument. */
export const USAGE = [
	"usage: deno task auth:parity [--project-ref <ref>] [--fixture <file>]",
	"  reads SUPABASE_PROJECT_REF and SUPABASE_ACCESS_TOKEN (shell, then .env.local)",
	"  --project-ref <ref>  check this project instead of SUPABASE_PROJECT_REF",
	"  --fixture <file>     compare a saved GET /v1/projects/{ref}/config/auth response; no network",
	"  exit 0 parity · 1 drift · 2 cannot run",
];

interface ParsedArgs {
	fixture?: string;
	projectRef?: string;
	help?: boolean;
	error?: string;
}

function parseArgs(args: readonly string[]): ParsedArgs {
	const out: ParsedArgs = {};
	for (let i = 0; i < args.length; i++) {
		const arg = args[i];
		if (arg === "--help" || arg === "-h") out.help = true;
		else if (arg === "--fixture" || arg === "--project-ref") {
			const value = args[++i];
			if (!value || value.startsWith("--")) return { error: `${arg} needs a value` };
			if (arg === "--fixture") out.fixture = value;
			else out.projectRef = value;
		} else return { error: `unknown argument ${arg.startsWith("-") ? arg : "(positional)"}` };
	}
	return out;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === "object" && !Array.isArray(value);
}

function usable(value: string | undefined): string | undefined {
	const trimmed = value?.trim();
	return trimmed && trimmed !== PLACEHOLDER ? trimmed : undefined;
}

/** Why the API refused, without echoing anything it sent back. */
function refusal(status: number): string {
	if (status === 401) return "the token was refused (expired, revoked or not a personal token)";
	if (status === 403) {
		return "the token cannot read this project's auth config (it needs auth:read / auth_config_read)";
	}
	if (status === 404) return "no project with that ref is visible to this token";
	if (status === 429) return "rate limited; try again in a minute";
	return "unexpected answer";
}

/**
 * Runs the check and returns the exit code. Every line goes through a redactor, so the access
 * token cannot reach the output even inside an error.
 */
export async function run(deps: ParityDeps): Promise<number> {
	const args = parseArgs(deps.args);
	const token = usable(deps.env("SUPABASE_ACCESS_TOKEN"));
	const say = (line: string) => deps.print(token ? line.replaceAll(token, "[redacted]") : line);

	if (args.error || args.help) {
		if (args.error) say(`auth:parity: ${args.error}`);
		USAGE.forEach(say);
		return args.help && !args.error ? 0 : 2;
	}

	let config: Record<string, unknown>;
	try {
		config = parseToml(
			await deps.readText(new URL("../supabase/config.toml", import.meta.url)),
		) as Record<string, unknown>;
	} catch (error) {
		say(`auth:parity: cannot read supabase/config.toml (${(error as Error).name})`);
		return 2;
	}

	let hosted: unknown;
	if (args.fixture) {
		try {
			hosted = JSON.parse(await deps.readText(args.fixture));
		} catch (error) {
			say(`auth:parity: cannot read the fixture ${args.fixture} (${(error as Error).name})`);
			return 2;
		}
		say(`auth:parity · fixture ${args.fixture}`);
	} else {
		const ref = usable(args.projectRef ?? deps.env("SUPABASE_PROJECT_REF"));
		const missing = [
			...(ref ? [] : ["SUPABASE_PROJECT_REF"]),
			...(token ? [] : ["SUPABASE_ACCESS_TOKEN"]),
		];
		if (missing.length > 0) {
			say(`auth:parity: set ${missing.join(" and ")} in .env.local (or the shell).`);
			say("  A personal access token: supabase.com/dashboard/account/tokens. Never commit it.");
			return 2;
		}
		if (!PROJECT_REF.test(ref!)) {
			say("auth:parity: the project ref is not 20 lowercase letters (Project Settings → General).");
			return 2;
		}
		say(`auth:parity · project ${ref} · GET ${MANAGEMENT_API}/v1/projects/{ref}/config/auth`);
		let response: Response;
		try {
			response = await deps.fetch(`${MANAGEMENT_API}/v1/projects/${ref}/config/auth`, {
				method: "GET",
				headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
				redirect: "error",
				signal: AbortSignal.timeout(20_000),
			});
		} catch (error) {
			say(`auth:parity: cannot reach the Management API (${(error as Error).name})`);
			return 2;
		}
		if (!response.ok) {
			await response.body?.cancel();
			say(
				`auth:parity: the Management API answered ${response.status}: ${refusal(response.status)}`,
			);
			return 2;
		}
		try {
			hosted = await response.json();
		} catch (error) {
			say(`auth:parity: the Management API's answer is not JSON (${(error as Error).name})`);
			return 2;
		}
	}

	if (!isRecord(hosted)) {
		say("auth:parity: the auth config is not a JSON object");
		return 2;
	}

	const rows = compareAuth(config, hosted);
	say("");
	renderTable(rows).forEach(say);
	say("");
	renderSummary(rows).forEach(say);
	return rows.every((row) => row.ok) ? 0 : 1;
}

/** The variables from the shell first, then `.env.local` (the app's own order). */
async function envReader(): Promise<(name: string) => string | undefined> {
	let local: Record<string, string> = {};
	try {
		local = parseDotenv(await Deno.readTextFile(new URL("../.env.local", import.meta.url)));
	} catch (error) {
		if (!(error instanceof Deno.errors.NotFound)) throw error;
	}
	return (name) => Deno.env.get(name) || local[name] || undefined;
}

if (import.meta.main) {
	const code = await run({
		args: Deno.args,
		env: await envReader(),
		readText: (path) => Deno.readTextFile(path),
		fetch: globalThis.fetch,
		print: (line) => console.log(line),
	});
	Deno.exit(code);
}
// #endregion
