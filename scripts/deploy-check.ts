/**
 * `deno task deploy:check --env-file <path> --target staging|production` checks the environment a
 * hosted release will run with, before anything is deployed (OPERATIONS_BUILD_PROMPTS.md OPS6,
 * PRD-G8; the release order is in documentation/architecture/DEPLOYMENT_RUNBOOK.md).
 *
 * Read-only and offline: it reads the env file you name and `deploy/release-gates.json` (or
 * `--gates <path>`), and nothing else. It runs with `--allow-read` only, so it can neither reach the
 * network nor read the shell's environment. It prints rule ids and key names, never a value.
 *
 * The required keys are `requiredIn(target)` from `packages/backend/core/env-manifest.ts`; this file
 * keeps no list of its own. It checks presence and shape only. Whether the Stripe account behind the
 * keys is configured is `deno task stripe:preflight`'s question (MR6, Decision #476), and whether
 * Vault holds the same bearers is `cron:vault --check`'s (OPS1).
 *
 * Exit codes: 0 every rule holds · 1 one or more rules broken · 2 cannot run (a bad argument, an
 * unreadable env file, or a gates file that is not the expected JSON).
 */
import { parse as parseDotenv } from "@std/dotenv";
import {
	ENV_MANIFEST,
	HOSTED_TARGETS,
	type HostedTarget,
	isSchedulerBearer,
	liveAppGates,
	manifestEntry,
	MOCK_SWITCHES,
	requiredIn,
} from "@projective/backend/core/env-manifest.ts";
import { isTurnstileTestKey } from "@projective/backend/core/turnstile.ts";

// #region Rules
/** Every rule `deploy:check` enforces, in the order findings print. */
export const RULES = [
	"required",
	"deno-env",
	"app-url",
	"supabase-url",
	"stripe-mode",
	"stripe-webhooks",
	"encryption-key",
	"cron-secret",
	"turnstile",
	"use-mocks",
	"gates",
	"alerts",
	"confined",
] as const;

/** A rule id. */
export type RuleId = typeof RULES[number];

/** One broken rule on one key. `reason` is fixed text: it never carries the value. */
export interface Finding {
	rule: RuleId;
	/** A key name, or two names joined by ` = ` for a reused bearer. */
	key: string;
	reason: string;
}

/** Something worth reading that breaks no rule: an unknown key, a key the app never reads. */
export interface Note {
	key: string;
	reason: string;
}

/** What one target declares for each live feature gate (`deploy/release-gates.json`). */
export type GateDeclaration = Readonly<Record<string, boolean>>;

/** The input of {@link checkEnv}. */
export interface CheckInput {
	/** The parsed env file. */
	env: Readonly<Record<string, string>>;
	target: HostedTarget;
	/** The target's gate declaration. */
	gates: GateDeclaration;
}

/** The outcome of {@link checkEnv}. */
export interface CheckResult {
	findings: Finding[];
	notes: Note[];
}

const PLACEHOLDER = "XXXX-XXXX";

const STRIPE_WEBHOOK_SECRETS = [
	"STRIPE_WEBHOOK_SECRET",
	"STRIPE_THIN_WEBHOOK_SECRET",
	"STRIPE_CONNECT_WEBHOOK_SECRET",
] as const;

const TURNSTILE_KEYS = [
	"TURNSTILE_SITE_KEY",
	"TURNSTILE_SECRET_KEY",
	"SUPABASE_AUTH_CAPTCHA_SECRET",
] as const;

/** The rule a missing required key is reported under, so each finding names what it breaks. */
function ruleForMissing(name: string): RuleId {
	if (name === "DENO_ENV") return "deno-env";
	if (name === "APP_URL") return "app-url";
	if (name === "SUPABASE_URL") return "supabase-url";
	if ((STRIPE_WEBHOOK_SECRETS as readonly string[]).includes(name)) return "stripe-webhooks";
	if (name === "STRIPE_SECRET_KEY" || name === "NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY") {
		return "stripe-mode";
	}
	if (name === "ENCRYPTION_KEY") return "encryption-key";
	if (isSchedulerBearer(name)) return "cron-secret";
	if ((TURNSTILE_KEYS as readonly string[]).includes(name)) return "turnstile";
	if (liveAppGates().includes(name)) return "gates";
	if (name.startsWith("OPS_ALERT_")) return "alerts";
	return "required";
}

/** The trimmed value, or `undefined` when it is unset, empty or the placeholder. */
function usable(env: Readonly<Record<string, string>>, name: string): string | undefined {
	const value = env[name]?.trim();
	return value && value !== PLACEHOLDER ? value : undefined;
}

/**
 * Whether a hostname is this machine, a private network or a development-only name. A hosted
 * release reaches nothing by those.
 */
export function isLocalHost(hostname: string): boolean {
	const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
	if (host === "localhost" || host.endsWith(".localhost")) return true;
	if (host === "::1" || host === "0.0.0.0" || host === "host.docker.internal" || host === "kong") {
		return true;
	}
	if (/\.(local|test|internal|lan)$/.test(host)) return true;
	const v4 = host.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
	if (v4) {
		const [a, b] = [Number(v4[1]), Number(v4[2])];
		return a === 127 || a === 10 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31) ||
			(a === 169 && b === 254);
	}
	return /^f[cd][0-9a-f]{2}:/.test(host) || /^fe80:/.test(host);
}

function parseUrl(value: string): URL | null {
	try {
		return new URL(value);
	} catch {
		return null;
	}
}

/** The reason a URL a hosted release depends on is unusable, or `null` when it is fine. */
function hostedUrlProblem(value: string): string | null {
	const url = parseUrl(value);
	if (!url) return "is not an absolute URL";
	if (isLocalHost(url.hostname)) return "points at a local or private host";
	if (url.protocol !== "https:") return "is not https";
	return null;
}

/** `live` or `test` from a Stripe key's prefix (`sk_`, `rk_`, `pk_`), or `null` for another shape. */
function stripeMode(value: string, prefixes: readonly string[]): "live" | "test" | null {
	const match = value.match(/^([a-z]+)_(live|test)_/);
	if (!match || !prefixes.includes(match[1])) return null;
	return match[2] as "live" | "test";
}

/**
 * Checks one parsed env file against the rules for `target`. Pure: no I/O, and no value reaches a
 * finding or a note.
 */
export function checkEnv(input: CheckInput): CheckResult {
	const { env, target, gates } = input;
	const findings: Finding[] = [];
	const notes: Note[] = [];
	const add = (rule: RuleId, key: string, reason: string) => findings.push({ rule, key, reason });

	// required: every live key the manifest requires on this target.
	for (const name of requiredIn(target)) {
		const raw = env[name]?.trim();
		if (!raw) add(ruleForMissing(name), name, `is missing (required in ${target})`);
		else if (raw === PLACEHOLDER) {
			add(ruleForMissing(name), name, `is still the ${PLACEHOLDER} placeholder`);
		}
	}

	// deno-env
	const denoEnv = usable(env, "DENO_ENV");
	if (denoEnv && denoEnv !== "production") {
		add("deno-env", "DENO_ENV", "is not production (every hosted target runs as production)");
	}

	// app-url: the public origin, which is also GoTrue's Site URL.
	const appUrl = usable(env, "APP_URL");
	if (appUrl) {
		const problem = hostedUrlProblem(appUrl);
		const url = parseUrl(appUrl);
		if (problem) add("app-url", "APP_URL", problem);
		else if (url && (url.pathname !== "/" || url.search || url.hash || appUrl.endsWith("/"))) {
			add("app-url", "APP_URL", "is not a bare origin (no path, query or trailing slash)");
		}
	}

	// supabase-url
	for (const name of ["SUPABASE_URL", "SUPABASE_PUBLIC_URL"]) {
		const value = usable(env, name);
		const problem = value ? hostedUrlProblem(value) : null;
		if (problem) add("supabase-url", name, problem);
	}

	// stripe-mode: live keys only in production, test keys only in staging.
	const wanted = target === "production" ? "live" : "test";
	const stripeKeys: [string, readonly string[], string][] = [
		["STRIPE_SECRET_KEY", ["sk", "rk"], "a Stripe secret or restricted key (sk_… or rk_…)"],
		["STRIPE_PREFLIGHT_KEY", ["rk"], "a Stripe restricted key (rk_…)"],
		["NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY", ["pk"], "a Stripe publishable key (pk_…)"],
	];
	for (const [name, prefixes, shape] of stripeKeys) {
		const value = usable(env, name);
		if (!value) continue;
		const mode = stripeMode(value, prefixes);
		if (!mode) add("stripe-mode", name, `is not ${shape}`);
		else if (mode !== wanted) {
			add("stripe-mode", name, `is a ${mode} key; ${target} takes ${wanted} keys only`);
		}
	}

	// stripe-webhooks: each destination's signing secret.
	for (const name of STRIPE_WEBHOOK_SECRETS) {
		const value = usable(env, name);
		if (value && !value.startsWith("whsec_")) {
			add("stripe-webhooks", name, "is not a webhook signing secret (whsec_…)");
		}
	}

	// encryption-key: the token vault's KEK (Decision #343, ruling C4 (c)).
	const kek = usable(env, "ENCRYPTION_KEY");
	if (kek && !/^[0-9a-fA-F]{64}$/.test(kek)) {
		add("encryption-key", "ENCRYPTION_KEY", "is not 64 hex characters (32 bytes)");
	}

	// cron-secret: at least 32 characters (core/bearer.ts), and no two the same.
	const bearers = Object.keys(env).filter(isSchedulerBearer).sort();
	const seen = new Map<string, string>();
	for (const name of bearers) {
		const value = usable(env, name);
		if (!value) continue;
		if (value.length < 32) add("cron-secret", name, "is shorter than 32 characters");
		const twin = seen.get(value);
		if (twin) add("cron-secret", `${twin} = ${name}`, "two scheduler bearers hold the same value");
		else seen.set(value, name);
	}

	// turnstile: Cloudflare's published test keys pass every bot (Decision #447).
	for (const name of TURNSTILE_KEYS) {
		const value = usable(env, name);
		if (value && isTurnstileTestKey(value)) {
			add("turnstile", name, "is one of Cloudflare's published test keys");
		}
	}

	// use-mocks: either name of the switch turns every gate off and every client factory away.
	for (const name of MOCK_SWITCHES) {
		if (env[name]?.trim().toLowerCase() === "true") {
			add("use-mocks", name, "is true: the app would reach no database");
		}
	}

	// gates: each live feature gate as the release declares it.
	const declared = new Set(Object.keys(gates));
	for (const name of liveAppGates()) {
		if (!declared.has(name)) {
			add("gates", name, `is not declared for ${target} in the gates file`);
			continue;
		}
		const raw = env[name]?.trim();
		if (!raw) continue;
		const lower = raw.toLowerCase();
		if (lower !== "true" && lower !== "false") {
			add("gates", name, "is neither true nor false (the app reads it as false)");
			continue;
		}
		const on = lower === "true";
		if (on !== gates[name]) {
			add(
				"gates",
				name,
				`is ${on ? "on" : "off"}; the release declares it ${gates[name] ? "on" : "off"}`,
			);
		}
	}
	for (const name of declared) {
		if (!liveAppGates().includes(name)) {
			add("gates", name, `is declared for ${target} but is not a live gate in the env manifest`);
		}
	}

	// alerts: production failures must reach a person (MR4, Decision #461).
	if (target === "production") {
		const hook = usable(env, "OPS_ALERT_WEBHOOK_URL");
		const hookProblem = hook ? hostedUrlProblem(hook) : null;
		if (hookProblem) add("alerts", "OPS_ALERT_WEBHOOK_URL", hookProblem);
		const mail = usable(env, "OPS_ALERT_EMAIL");
		if (mail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mail)) {
			add("alerts", "OPS_ALERT_EMAIL", "is not one email address");
		}
	}

	// confined: development overrides and operator credentials stay off a host.
	for (const name of Object.keys(env).sort()) {
		const entry = manifestEntry(name);
		if (!env[name]?.trim()) continue;
		if (entry?.confine === "development") {
			add("confined", name, "is a development override; a hosted env must not set it");
		} else if (entry?.confine === "operator") {
			add(
				"confined",
				name,
				"is an operator credential; keep it in your own env file, not the env the host receives",
			);
		}
	}

	// Notes, which break nothing.
	for (const name of Object.keys(env).sort()) {
		const entry = manifestEntry(name);
		if (!entry) {
			notes.push({ key: name, reason: "is not in the env manifest (a typo, or a key to add)" });
		} else if (entry.status === "planned") {
			notes.push({ key: name, reason: `is planned (${entry.plannedBy}); nothing reads it yet` });
		} else if (entry.reader === "supabase-cli") {
			notes.push({ key: name, reason: "is read only by the Supabase CLI; the app ignores it" });
		}
	}

	findings.sort((a, b) =>
		RULES.indexOf(a.rule) - RULES.indexOf(b.rule) || a.key.localeCompare(b.key)
	);
	return { findings, notes };
}
// #endregion

// #region Gates file
/** The default gates file, relative to the repo root. */
export const GATES_FILE = "deploy/release-gates.json";

/** Reads one target's declaration out of a parsed gates file, or says why it cannot. */
export function gatesFor(
	parsed: unknown,
	target: HostedTarget,
): { gates: GateDeclaration } | { error: string } {
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
		return { error: "the gates file is not a JSON object" };
	}
	const block = (parsed as Record<string, unknown>)[target];
	if (!block || typeof block !== "object" || Array.isArray(block)) {
		return { error: `the gates file has no "${target}" object` };
	}
	const gates: Record<string, boolean> = {};
	for (const [name, value] of Object.entries(block)) {
		if (typeof value !== "boolean") {
			return { error: `the gates file's ${target}.${name} is not a boolean` };
		}
		gates[name] = value;
	}
	return { gates };
}
// #endregion

// #region CLI
/** What {@link run} needs from the outside world. Tests pass fakes. */
export interface DeployCheckDeps {
	args: readonly string[];
	/** Reads a file by path (relative to the working directory, which `deno task` sets to the root). */
	readText: (path: string) => Promise<string>;
	print: (line: string) => void;
}

const USAGE = [
	"usage: deno task deploy:check --env-file <path> --target staging|production [--gates <path>]",
	"  --env-file <path>  the env file the host will receive (read only; never printed)",
	"  --target <name>    staging (test-mode Stripe) or production (live-mode Stripe)",
	`  --gates <path>     the release's gate declaration (default ${GATES_FILE})`,
	"  exit 0 every rule holds · 1 a rule is broken · 2 cannot run",
];

interface ParsedArgs {
	envFile?: string;
	target?: string;
	gates?: string;
	help?: boolean;
	error?: string;
}

function parseArgs(args: readonly string[]): ParsedArgs {
	const out: ParsedArgs = {};
	for (let i = 0; i < args.length; i++) {
		const arg = args[i];
		if (arg === "--help" || arg === "-h") out.help = true;
		else if (arg === "--env-file" || arg === "--target" || arg === "--gates") {
			const value = args[++i];
			if (!value || value.startsWith("--")) return { error: `${arg} needs a value` };
			if (arg === "--env-file") out.envFile = value;
			else if (arg === "--target") out.target = value;
			else out.gates = value;
		} else return { error: `unknown argument ${arg.startsWith("-") ? arg : "(positional)"}` };
	}
	return out;
}

function isHostedTarget(value: string | undefined): value is HostedTarget {
	return (HOSTED_TARGETS as readonly string[]).includes(value ?? "");
}

/** Runs the check and returns the exit code. */
export async function run(deps: DeployCheckDeps): Promise<number> {
	const say = deps.print;
	const args = parseArgs(deps.args);
	if (args.error || args.help) {
		if (args.error) say(`deploy:check: ${args.error}`);
		USAGE.forEach(say);
		return args.help && !args.error ? 0 : 2;
	}
	if (!args.envFile) {
		say("deploy:check: --env-file is required");
		USAGE.forEach(say);
		return 2;
	}
	if (!isHostedTarget(args.target)) {
		say("deploy:check: --target must be staging or production");
		USAGE.forEach(say);
		return 2;
	}
	const target = args.target;

	let env: Record<string, string>;
	try {
		env = parseDotenv((await deps.readText(args.envFile)).replaceAll("\r", ""));
	} catch (error) {
		say(`deploy:check: cannot read the env file ${args.envFile} (${(error as Error).name})`);
		return 2;
	}

	const gatesPath = args.gates ?? GATES_FILE;
	let declaration: GateDeclaration;
	try {
		const result = gatesFor(JSON.parse(await deps.readText(gatesPath)), target);
		if ("error" in result) {
			say(`deploy:check: ${result.error} (${gatesPath})`);
			return 2;
		}
		declaration = result.gates;
	} catch (error) {
		say(`deploy:check: cannot read the gates file ${gatesPath} (${(error as Error).name})`);
		return 2;
	}

	const { findings, notes } = checkEnv({ env, target, gates: declaration });
	say(
		`deploy:check · target ${target} · ${Object.keys(env).length} keys · ` +
			`${requiredIn(target).length} required · ${ENV_MANIFEST.length} in the manifest`,
	);
	const width = Math.max(...RULES.map((rule) => rule.length));
	for (const finding of findings) {
		say(`  ✗ ${finding.rule.padEnd(width)}  ${finding.key}  ${finding.reason}`);
	}
	for (const note of notes) say(`  · ${"note".padEnd(width)}  ${note.key}  ${note.reason}`);
	if (findings.length === 0) {
		say("deploy:check: every rule holds");
		return 0;
	}
	const broken = RULES.filter((rule) => findings.some((finding) => finding.rule === rule));
	say(`deploy:check: ${findings.length} finding(s); broken: ${broken.join(", ")}`);
	return 1;
}

if (import.meta.main) {
	Deno.exit(
		await run({
			args: Deno.args,
			readText: (path) => Deno.readTextFile(path),
			print: (line) => console.log(line),
		}),
	);
}
// #endregion
