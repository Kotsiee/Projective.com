/**
 * `scripts/deploy-check.ts` (OPS6, PRD-G8) on its two complete fixture env files and on one broken
 * variant per rule. No network and no real environment: `run` reads only the in-memory files the
 * harness hands it. Pins every rule, the exit codes, that no value ever reaches the output, and that
 * the committed `deploy/release-gates.json` declares exactly the manifest's live gates.
 */
import { assert, assertEquals, assertFalse, assertStringIncludes } from "@std/assert";
import { parse as parseDotenv } from "@std/dotenv";
import {
	ENV_MANIFEST,
	HOSTED_TARGETS,
	isSchedulerBearer,
	liveAppGates,
	requiredIn,
} from "@projective/backend/core/env-manifest.ts";
import {
	checkEnv,
	type GateDeclaration,
	gatesFor,
	isLocalHost,
	type RuleId,
	RULES,
	run,
} from "./deploy-check.ts";

// #region Harness
type Target = typeof HOSTED_TARGETS[number];

const read = (path: string) => Deno.readTextFile(new URL(path, import.meta.url));

const FIXTURES: Record<Target, Record<string, string>> = {
	staging: parseDotenv((await read("./deploy-check.staging.fixture.env")).replaceAll("\r", "")),
	production: parseDotenv(
		(await read("./deploy-check.production.fixture.env")).replaceAll("\r", ""),
	),
};

/** The declaration the fixtures are written against: every gate on, embeddings off. */
const GATES: GateDeclaration = Object.fromEntries(
	liveAppGates().map((name) => [name, name !== "EMBEDDINGS_ENABLED"]),
);
const GATES_JSON = JSON.stringify({ staging: GATES, production: GATES });

/** Serialises a record as an env file; every value double-quoted, as a real file may be. */
function envFile(env: Record<string, string>): string {
	return Object.entries(env).map(([key, value]) => `${key}=${JSON.stringify(value)}`).join("\r\n");
}

/** The target's fixture with `changes` applied; `null` deletes a key. */
function variant(target: Target, changes: Record<string, string | null>): Record<string, string> {
	const env = { ...FIXTURES[target] };
	for (const [key, value] of Object.entries(changes)) {
		if (value === null) delete env[key];
		else env[key] = value;
	}
	return env;
}

interface Outcome {
	code: number;
	out: string;
}

const outputs: string[] = [];

async function cli(args: string[], files: Record<string, string>): Promise<Outcome> {
	const lines: string[] = [];
	const code = await run({
		args,
		readText: (path) =>
			path in files ? Promise.resolve(files[path]) : Promise.reject(new Deno.errors.NotFound(path)),
		print: (line) => lines.push(line),
	});
	const out = lines.join("\n");
	outputs.push(out);
	return { code, out };
}

async function check(
	target: Target,
	env: Record<string, string>,
	gates = GATES_JSON,
): Promise<Outcome> {
	return await cli(
		["--env-file", "host.env", "--target", target, "--gates", "gates.json"],
		{ "host.env": envFile(env), "gates.json": gates },
	);
}

/** The rule ids a check broke, read from the pure checker. */
function broken(
	target: Target,
	env: Record<string, string>,
	gates: GateDeclaration = GATES,
): RuleId[] {
	return [...new Set(checkEnv({ env, target, gates }).findings.map((finding) => finding.rule))];
}

/** Asserts the variant fails on exactly `rule` and names `key` beside it. */
async function failsOn(
	target: Target,
	changes: Record<string, string | null>,
	rule: RuleId,
	key: string,
) {
	const env = variant(target, changes);
	assertEquals(broken(target, env), [rule], `${target} ${JSON.stringify(Object.keys(changes))}`);
	const { code, out } = await check(target, env);
	assertEquals(code, 1);
	assert(
		out.split("\n").some((line) => line.includes(`✗ ${rule}`) && line.includes(key)),
		`expected a "${rule}" line naming ${key}:\n${out}`,
	);
	assertStringIncludes(out, `broken: ${rule}`);
}
// #endregion

// #region The complete fixtures pass
for (const target of HOSTED_TARGETS) {
	Deno.test(`deploy:check — the complete ${target} fixture passes every rule`, async () => {
		assertEquals(checkEnv({ env: FIXTURES[target], target, gates: GATES }).findings, []);
		const { code, out } = await check(target, FIXTURES[target]);
		assertEquals(code, 0, out);
		assertStringIncludes(out, "deploy:check: every rule holds");
		assertStringIncludes(out, `target ${target}`);
	});
}

Deno.test("deploy:check — the staging fixture fails as production, and the production one as staging", async () => {
	assertEquals((await check("production", FIXTURES.staging)).code, 1);
	assertEquals((await check("staging", FIXTURES.production)).code, 1);
	assert(broken("production", FIXTURES.staging).includes("stripe-mode"));
	assert(broken("production", FIXTURES.staging).includes("alerts"));
	assert(broken("staging", FIXTURES.production).includes("stripe-mode"));
});
// #endregion

// #region One broken variant per rule
Deno.test("rule required — a required key missing, empty or still the placeholder", async () => {
	await failsOn("staging", { RESEND_API_KEY: null }, "required", "RESEND_API_KEY");
	await failsOn("staging", { MAIL_FROM: "XXXX-XXXX" }, "required", "MAIL_FROM");
	await failsOn(
		"production",
		{ SUPABASE_SERVICE_ROLE_KEY: "" },
		"required",
		"SUPABASE_SERVICE_ROLE_KEY",
	);
	assertStringIncludes(
		(await check("staging", variant("staging", { MAIL_FROM: "XXXX-XXXX" }))).out,
		"still the XXXX-XXXX placeholder",
	);
});

Deno.test("rule deno-env — DENO_ENV must be production on every hosted target", async () => {
	await failsOn("staging", { DENO_ENV: "development" }, "deno-env", "DENO_ENV");
	await failsOn("production", { DENO_ENV: null }, "deno-env", "DENO_ENV");
});

Deno.test("rule app-url — APP_URL is a bare https origin on a public host", async () => {
	await failsOn("staging", { APP_URL: "http://staging.example.com" }, "app-url", "APP_URL");
	await failsOn("staging", { APP_URL: "https://localhost:3000" }, "app-url", "APP_URL");
	await failsOn("staging", { APP_URL: "https://staging.example.com/" }, "app-url", "APP_URL");
	await failsOn("production", { APP_URL: "https://app.example.com/app" }, "app-url", "APP_URL");
	await failsOn("production", { APP_URL: "app.example.com" }, "app-url", "APP_URL");
});

Deno.test("rule supabase-url — SUPABASE_URL and SUPABASE_PUBLIC_URL are never local", async () => {
	await failsOn(
		"staging",
		{ SUPABASE_URL: "http://127.0.0.1:54321" },
		"supabase-url",
		"SUPABASE_URL",
	);
	await failsOn(
		"staging",
		{ SUPABASE_URL: "http://host.docker.internal:54321" },
		"supabase-url",
		"SUPABASE_URL",
	);
	await failsOn(
		"production",
		{ SUPABASE_PUBLIC_URL: "https://storage.localhost" },
		"supabase-url",
		"SUPABASE_PUBLIC_URL",
	);
	await failsOn("production", { SUPABASE_URL: null }, "supabase-url", "SUPABASE_URL");
});

Deno.test("rule stripe-mode — live keys only in production, test keys only in staging", async () => {
	await failsOn(
		"staging",
		{ STRIPE_SECRET_KEY: "sk_live_fixture-not-a-real-key" },
		"stripe-mode",
		"STRIPE_SECRET_KEY",
	);
	await failsOn(
		"production",
		{ STRIPE_SECRET_KEY: "sk_test_fixture-not-a-real-key" },
		"stripe-mode",
		"STRIPE_SECRET_KEY",
	);
	await failsOn(
		"production",
		{ NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: "pk_test_fixture-not-a-real-key" },
		"stripe-mode",
		"NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY",
	);
	await failsOn(
		"production",
		{ STRIPE_PREFLIGHT_KEY: "rk_test_fixture-not-a-real-key" },
		"stripe-mode",
		"STRIPE_PREFLIGHT_KEY",
	);
	await failsOn(
		"staging",
		{ STRIPE_SECRET_KEY: "pk_test_fixture-not-a-real-key" },
		"stripe-mode",
		"STRIPE_SECRET_KEY",
	);
	await failsOn("staging", { STRIPE_SECRET_KEY: null }, "stripe-mode", "STRIPE_SECRET_KEY");
});

Deno.test("rule stripe-webhooks — each destination's signing secret is present and a whsec_", async () => {
	await failsOn(
		"staging",
		{ STRIPE_THIN_WEBHOOK_SECRET: null },
		"stripe-webhooks",
		"STRIPE_THIN_WEBHOOK_SECRET",
	);
	await failsOn(
		"production",
		{ STRIPE_CONNECT_WEBHOOK_SECRET: "XXXX-XXXX" },
		"stripe-webhooks",
		"STRIPE_CONNECT_WEBHOOK_SECRET",
	);
	await failsOn(
		"production",
		{ STRIPE_WEBHOOK_SECRET: "fixture-not-a-signing-secret" },
		"stripe-webhooks",
		"STRIPE_WEBHOOK_SECRET",
	);
});

Deno.test("rule encryption-key — ENCRYPTION_KEY is 64 hex characters", async () => {
	await failsOn("staging", { ENCRYPTION_KEY: "0".repeat(63) }, "encryption-key", "ENCRYPTION_KEY");
	await failsOn(
		"production",
		{ ENCRYPTION_KEY: "g".repeat(64) },
		"encryption-key",
		"ENCRYPTION_KEY",
	);
	await failsOn("production", { ENCRYPTION_KEY: null }, "encryption-key", "ENCRYPTION_KEY");
});

Deno.test("rule cron-secret — every bearer is at least 32 characters and no two are equal", async () => {
	await failsOn(
		"staging",
		{ FINANCE_CRON_SECRET: "fixture-too-short" },
		"cron-secret",
		"FINANCE_CRON_SECRET",
	);
	await failsOn(
		"production",
		{ OPS_CRON_SECRET: FIXTURES.production.ACCOUNT_CRON_SECRET },
		"cron-secret",
		"ACCOUNT_CRON_SECRET = OPS_CRON_SECRET",
	);
	await failsOn("staging", { COMMS_DISPATCH_SECRET: null }, "cron-secret", "COMMS_DISPATCH_SECRET");
	assertStringIncludes(
		(await check(
			"production",
			variant("production", { OPS_CRON_SECRET: FIXTURES.production.ACCOUNT_CRON_SECRET }),
		))
			.out,
		"two scheduler bearers hold the same value",
	);
});

Deno.test("rule turnstile — Cloudflare's published test keys are refused (#447)", async () => {
	await failsOn(
		"staging",
		{ TURNSTILE_SITE_KEY: "1x00000000000000000000AA" },
		"turnstile",
		"TURNSTILE_SITE_KEY",
	);
	await failsOn(
		"production",
		{ TURNSTILE_SECRET_KEY: "1x0000000000000000000000000000000AA" },
		"turnstile",
		"TURNSTILE_SECRET_KEY",
	);
	assert(
		broken(
			"staging",
			variant("staging", { SUPABASE_AUTH_CAPTCHA_SECRET: "2x0000000000000000000000000000000AA" }),
		)
			.includes("turnstile"),
	);
});

Deno.test("rule use-mocks — either name of the no-database switch set true", async () => {
	await failsOn("staging", { USE_MOCKS: "true" }, "use-mocks", "USE_MOCKS");
	await failsOn("production", { VITE_USE_MOCKS: "TRUE" }, "use-mocks", "VITE_USE_MOCKS");
	assertEquals(broken("production", variant("production", { USE_MOCKS: "false" })), []);
});

Deno.test("rule gates — every live gate set as the release declares it", async () => {
	await failsOn("staging", { FINANCE_BACKEND_LIVE: "false" }, "gates", "FINANCE_BACKEND_LIVE");
	await failsOn("production", { EMBEDDINGS_ENABLED: "true" }, "gates", "EMBEDDINGS_ENABLED");
	await failsOn("production", { PROJECTS_BACKEND_LIVE: "yes" }, "gates", "PROJECTS_BACKEND_LIVE");
	await failsOn("staging", { CONTACT_BACKEND_LIVE: null }, "gates", "CONTACT_BACKEND_LIVE");

	const { FILES_BACKEND_LIVE: _dropped, ...undeclared } = GATES;
	assertEquals(broken("staging", FIXTURES.staging, undeclared), ["gates"]);
	assertEquals(broken("staging", FIXTURES.staging, { ...GATES, SOMETHING_BACKEND_LIVE: true }), [
		"gates",
	]);
	const { code, out } = await check(
		"staging",
		FIXTURES.staging,
		JSON.stringify({ staging: undeclared }),
	);
	assertEquals(code, 1);
	assertStringIncludes(out, "FILES_BACKEND_LIVE  is not declared for staging");
});

Deno.test("rule alerts — production's alert channels are set and well formed", async () => {
	await failsOn("production", { OPS_ALERT_EMAIL: null }, "alerts", "OPS_ALERT_EMAIL");
	await failsOn(
		"production",
		{ OPS_ALERT_WEBHOOK_URL: "XXXX-XXXX" },
		"alerts",
		"OPS_ALERT_WEBHOOK_URL",
	);
	await failsOn(
		"production",
		{ OPS_ALERT_WEBHOOK_URL: "http://hooks.example.com/x" },
		"alerts",
		"OPS_ALERT_WEBHOOK_URL",
	);
	await failsOn("production", { OPS_ALERT_EMAIL: "ops at example" }, "alerts", "OPS_ALERT_EMAIL");
	assertFalse(broken("staging", variant("staging", {})).includes("alerts"));
});

Deno.test("rule confined — development overrides and operator credentials stay off a host", async () => {
	await failsOn(
		"staging",
		{ STRIPE_API_BASE: "http://localhost:12111" },
		"confined",
		"STRIPE_API_BASE",
	);
	await failsOn(
		"production",
		{ VOYAGE_API_BASE: "https://mock.example.com" },
		"confined",
		"VOYAGE_API_BASE",
	);
	await failsOn(
		"staging",
		{ SUPABASE_ACCESS_TOKEN: "fixture-pat-not-a-real-token" },
		"confined",
		"SUPABASE_ACCESS_TOKEN",
	);
	await failsOn("production", { E2E_PASSWORD: "fixture-password" }, "confined", "E2E_PASSWORD");
	await failsOn(
		"production",
		{ CRON_VAULT_DB_URL: "postgresql://fixture-user@db.example.com:5432/postgres" },
		"confined",
		"CRON_VAULT_DB_URL",
	);
	await failsOn(
		"staging",
		{ CRON_VAULT_DB_CA: "./fixture-ca.crt" },
		"confined",
		"CRON_VAULT_DB_CA",
	);
	const withVaultOrigin = await check(
		"staging",
		variant("staging", { CRON_APP_URL: "https://staging.example.com" }),
	);
	assertEquals(withVaultOrigin.code, 0, withVaultOrigin.out);
	assertFalse(
		withVaultOrigin.out.includes("CRON_APP_URL"),
		"the Vault origin is a known tooling key",
	);
});

Deno.test("every rule has a broken variant above", () => {
	const exercised = new Set(
		outputs.flatMap((out) => [...out.matchAll(/✗ ([a-z-]+)/g)].map((match) => match[1])),
	);
	for (const rule of RULES) assert(exercised.has(rule), `no test breaks "${rule}"`);
});
// #endregion

// #region Notes, the CLI and secrecy
Deno.test("notes — an unknown key, a CLI-only key and a planned key break nothing", async () => {
	const env = variant("staging", {
		STRIPE_WEBHOOK_SECRT: "whsec_fixture-typo",
		SUPABASE_AUTH_SMTP_PASS: "fixture-smtp-pass",
		SAFETY_NODE_URL: "https://safety.example.com",
	});
	const { code, out } = await check("staging", env);
	assertEquals(code, 0, out);
	assertStringIncludes(out, "STRIPE_WEBHOOK_SECRT  is not in the env manifest");
	assertStringIncludes(out, "SUPABASE_AUTH_SMTP_PASS  is read only by the Supabase CLI");
	assertStringIncludes(out, "SAFETY_NODE_URL  is planned (T&S SN1)");
});

Deno.test("cli — a bad argument, an unreadable file or a bad gates file cannot run (exit 2)", async () => {
	const files = { "host.env": envFile(FIXTURES.staging), "gates.json": GATES_JSON };
	assertEquals((await cli([], files)).code, 2);
	assertEquals((await cli(["--target", "staging"], files)).code, 2);
	assertEquals(
		(await cli(["--env-file", "host.env", "--target", "uat", "--gates", "gates.json"], files)).code,
		2,
	);
	assertEquals((await cli(["--env-file", "host.env", "--target"], files)).code, 2);
	assertEquals(
		(await cli(["--env-file", "host.env", "--target", "staging", "extra"], files)).code,
		2,
	);
	assertEquals(
		(await cli(
			["--env-file", "missing.env", "--target", "staging", "--gates", "gates.json"],
			files,
		)).code,
		2,
	);
	for (
		const gates of [
			"not json",
			"[]",
			JSON.stringify({ production: GATES }),
			JSON.stringify({ staging: { AUTH_BACKEND_LIVE: "true" } }),
		]
	) {
		const outcome = await cli(
			["--env-file", "host.env", "--target", "staging", "--gates", "gates.json"],
			{ ...files, "gates.json": gates },
		);
		assertEquals(outcome.code, 2, gates);
	}
	assertEquals((await cli(["--help"], files)).code, 0);
	const defaultGates = await cli(["--env-file", "host.env", "--target", "staging"], {
		...files,
		"deploy/release-gates.json": GATES_JSON,
	});
	assertEquals(defaultGates.code, 0, defaultGates.out);
});

Deno.test("secrecy — no value from any fixture or variant ever reaches the output", () => {
	const values = new Set<string>();
	for (const env of Object.values(FIXTURES)) {
		for (const value of Object.values(env)) if (value.length >= 12) values.add(value);
	}
	for (
		const extra of [
			"fixture-too-short",
			"fixture-pat-not-a-real-token",
			"sk_live_fixture-not-a-real-key",
			"1x0000000000000000000000000000000AA",
			"fixture-not-a-signing-secret",
			"http://127.0.0.1:54321",
		]
	) values.add(extra);
	assert(outputs.length > 40, "the secrecy check runs after the rule tests");
	for (const out of outputs) {
		for (const value of values) {
			assertFalse(out.includes(value), `a value reached the output:\n${out}`);
		}
	}
});
// #endregion

// #region The manifest and the committed gates file
Deno.test("manifest — names are unique, planned keys name their work order, confined keys are never required hosted", () => {
	const names = ENV_MANIFEST.map((entry) => entry.name);
	assertEquals(new Set(names).size, names.length);
	for (const entry of ENV_MANIFEST) {
		assert(/^[A-Z][A-Z0-9_]*$/.test(entry.name), entry.name);
		assertEquals(entry.status === "planned", Boolean(entry.plannedBy), entry.name);
		if (entry.confine) {
			assertFalse(
				entry.requiredIn.includes("staging") || entry.requiredIn.includes("production"),
				entry.name,
			);
		}
	}
	for (const target of HOSTED_TARGETS) {
		const required = requiredIn(target);
		for (const name of required) {
			assertEquals(ENV_MANIFEST.find((entry) => entry.name === name)?.status, "live");
		}
		for (
			const entry of ENV_MANIFEST.filter((entry) =>
				isSchedulerBearer(entry.name) && entry.status === "live"
			)
		) {
			assert(required.includes(entry.name), `${entry.name} is not required in ${target}`);
		}
	}
	assertFalse(
		requiredIn("production").includes("OPS_HEALTH_TOKEN"),
		"a planned key is never required",
	);
});

Deno.test("deploy/release-gates.json declares exactly the live gates, as booleans, for both targets", async () => {
	const parsed = JSON.parse(await read("../deploy/release-gates.json"));
	for (const target of HOSTED_TARGETS) {
		const result = gatesFor(parsed, target);
		assert("gates" in result, JSON.stringify(result));
		assertEquals(Object.keys(result.gates).sort(), liveAppGates().sort(), target);
	}
});

Deno.test("isLocalHost — loopback, private networks and development names", () => {
	for (
		const host of [
			"localhost",
			"app.localhost",
			"127.0.0.1",
			"[::1]",
			"10.1.2.3",
			"192.168.0.4",
			"172.20.0.1",
			"host.docker.internal",
			"kong",
			"api.test",
			"db.internal",
			"0.0.0.0",
		]
	) {
		assert(isLocalHost(host), host);
	}
	for (
		const host of [
			"staging.example.com",
			"abcdefghijklmnopqrst.supabase.co",
			"172.32.0.1",
			"8.8.8.8",
		]
	) {
		assertFalse(isLocalHost(host), host);
	}
});
// #endregion
