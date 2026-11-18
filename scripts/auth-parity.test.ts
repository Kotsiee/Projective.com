/**
 * `scripts/auth-parity.ts` (SAC6) against its fixture and a fake `fetch`: no network, no real
 * environment, no `.env.local`. Pins the field mapping, the diff, the exit codes, the secret
 * handling and that the access token never reaches the output.
 */
import { assert, assertEquals, assertFalse, assertStringIncludes } from "@std/assert";
import { parse } from "@std/toml";
import {
	compareAuth,
	lookup,
	MANAGEMENT_API,
	PARITY_KEYS,
	type ParityDeps,
	REQUIRED_CHARACTERS,
	requirementsName,
	run,
	secretState,
	TURNSTILE_TEST_SECRETS,
} from "./auth-parity.ts";

// #region Harness
const read = (path: string) => Deno.readTextFile(new URL(path, import.meta.url));
const CONFIG = parse(await read("../supabase/config.toml")) as Record<string, unknown>;
const FIXTURE_FILE = "scripts/auth-parity.fixture.json";
const FIXTURE = JSON.parse(await read("./auth-parity.fixture.json")) as Record<string, unknown>;

/** Deliberately not `sbp_` + 40 hex: a real-shaped PAT trips GitHub push protection. */
const TOKEN = "sbp_test-fixture-access-token-never-printed";
const REF = "abcdefghijklmnopqrst";
const SECRET = "hosted-secret-value-never-printed";

interface Outcome {
	code: number;
	out: string;
	lines: string[];
	requests: { url: string; init?: RequestInit }[];
}

interface HarnessOptions {
	args?: string[];
	env?: Record<string, string>;
	hosted?: unknown;
	status?: number;
	fetchError?: Error;
}

/** Runs the script with a fixture body served from memory, or a fake Management API. */
async function harness(options: HarnessOptions = {}): Promise<Outcome> {
	const lines: string[] = [];
	const requests: Outcome["requests"] = [];
	const body = JSON.stringify(options.hosted ?? FIXTURE);
	const deps: ParityDeps = {
		args: options.args ?? ["--fixture", FIXTURE_FILE],
		env: (name) => options.env?.[name],
		readText: (path) =>
			String(path) === FIXTURE_FILE ? Promise.resolve(body) : Deno.readTextFile(path),
		fetch: (input, init) => {
			requests.push({ url: String(input), init });
			if (options.fetchError) return Promise.reject(options.fetchError);
			return Promise.resolve(
				new Response(body, {
					status: options.status ?? 200,
					headers: { "content-type": "application/json" },
				}),
			);
		},
		print: (line) => lines.push(line),
	};
	const code = await run(deps);
	return { code, out: lines.join("\n"), lines, requests };
}

const LIVE_ENV = { SUPABASE_PROJECT_REF: REF, SUPABASE_ACCESS_TOKEN: TOKEN };

/** The table row printed for `key`. */
function rowOf(outcome: Outcome, key: string): string {
	const row = outcome.lines.find((line) => line.startsWith(`${key} `));
	assert(row, `no table row for ${key}`);
	return row;
}

/** A hosted value that differs from `value` the way a mis-set dashboard would. */
function flipped(value: unknown): unknown {
	if (typeof value === "boolean") return !value;
	if (typeof value === "number") return value - 2;
	if (value === REQUIRED_CHARACTERS.lower_upper_letters_digits) {
		return REQUIRED_CHARACTERS.letters_digits;
	}
	if (value === "turnstile") return "hcaptcha";
	return null;
}
// #endregion

// #region The fixture and the diff
Deno.test("auth:parity: the fixture prints a clean table and exits 0", async () => {
	const outcome = await harness();
	assertEquals(outcome.code, 0, outcome.out);
	assertEquals(outcome.lines[0], `auth:parity · fixture ${FIXTURE_FILE}`);
	assert(outcome.lines.some((line) => /^key\s+local\s+hosted\s+ok$/.test(line)));
	for (const { key } of PARITY_KEYS) assert(rowOf(outcome, key).endsWith("  ok"), key);
	assertFalse(outcome.out.includes("DRIFT"));
	assertStringIncludes(outcome.out, `${PARITY_KEYS.length} of ${PARITY_KEYS.length} keys match.`);
	assertStringIncludes(rowOf(outcome, "auth.password_requirements"), "lower_upper_letters_digits");
	assertStringIncludes(rowOf(outcome, "auth.mfa.totp.enroll_enabled"), "false (off until MFA1)");
});

Deno.test("auth:parity: each key changed alone exits 1 and names exactly that key", async () => {
	for (const entry of PARITY_KEYS) {
		const hosted = { ...FIXTURE, [entry.field]: flipped(FIXTURE[entry.field]) };
		const outcome = await harness({ hosted });
		assertEquals(outcome.code, 1, `${entry.key} went unnoticed`);
		assertStringIncludes(outcome.out, `1 of ${PARITY_KEYS.length} keys drift: ${entry.key}\n`);
		assertStringIncludes(outcome.out, `  ${entry.key}: set ${entry.field} to `);
		for (const other of PARITY_KEYS) {
			const row = rowOf(outcome, other.key);
			assert(row.endsWith(other === entry ? "  DRIFT" : "  ok"), `${entry.key} flip: ${row}`);
		}
	}
});

Deno.test("auth:parity: a field missing from the response drifts as absent", async () => {
	const { password_min_length: _dropped, ...hosted } = FIXTURE;
	const outcome = await harness({ hosted });
	assertEquals(outcome.code, 1);
	assertStringIncludes(rowOf(outcome, "auth.minimum_password_length"), "absent");
});

Deno.test("auth:parity: unset booleans drift rather than read as the default", () => {
	const rows = compareAuth(CONFIG, { ...FIXTURE, mfa_totp_enroll_enabled: null });
	const row = rows.find((r) => r.key === "auth.mfa.totp.enroll_enabled");
	assertEquals(row?.hosted, "unset");
	assertFalse(row?.ok);
});
// #endregion

// #region Field mapping
Deno.test("auth:parity: every pinned key exists in config.toml and in the fixture", () => {
	for (const { key, field } of PARITY_KEYS) {
		assert(lookup(CONFIG, key) !== undefined, `config.toml has no ${key}`);
		assert(field in FIXTURE, `the fixture has no ${field}`);
	}
	assertEquals(new Set(PARITY_KEYS.map((k) => k.field)).size, PARITY_KEYS.length);
});

Deno.test("auth:parity: every enabled provider that pins skip_nonce_check is in the list", () => {
	const external = lookup(CONFIG, "auth.external") as Record<string, Record<string, unknown>>;
	for (const [provider, settings] of Object.entries(external)) {
		if (settings.enabled !== true || !("skip_nonce_check" in settings)) continue;
		assert(
			PARITY_KEYS.some((k) => k.key === `auth.external.${provider}.skip_nonce_check`),
			`[auth.external.${provider}] skip_nonce_check is not checked on the hosted project`,
		);
	}
});

Deno.test("auth:parity: password_requirements maps to the API's exact enum strings", () => {
	assertEquals(
		REQUIRED_CHARACTERS[lookup(CONFIG, "auth.password_requirements") as string],
		[
			"abcdefghijklmnopqrstuvwxyz",
			"ABCDEFGHIJKLMNOPQRSTUVWXYZ",
			"0123456789",
		].join(":"),
	);
	for (const [name, characters] of Object.entries(REQUIRED_CHARACTERS)) {
		assertEquals(requirementsName(characters), name);
	}
	assertEquals(requirementsName(null), "");
	assertEquals(requirementsName("abc"), undefined);
	assertEquals(REQUIRED_CHARACTERS.lower_upper_letters_digits_symbols.length, 98);
});

Deno.test("auth:parity: MFA TOTP is expected off until MFA1", () => {
	assertEquals(lookup(CONFIG, "auth.mfa.totp.enroll_enabled"), false);
	assertEquals(lookup(CONFIG, "auth.mfa.totp.verify_enabled"), false);
	const totp = PARITY_KEYS.filter((k) => k.key.startsWith("auth.mfa.totp."));
	assertEquals(totp.map((k) => k.note), ["off until MFA1", "off until MFA1"]);
});
// #endregion

// #region Secrets
Deno.test("auth:parity: a secret is classified, never shown", async () => {
	assertEquals(secretState(null), "unset");
	assertEquals(secretState(""), "unset");
	assertEquals(secretState("   "), "unset");
	assertEquals(secretState(SECRET), "set");
	for (const [secret, digest] of Object.entries(TURNSTILE_TEST_SECRETS)) {
		assertEquals(secretState(secret), "test secret");
		assertEquals(secretState(digest), "test secret");
		assertEquals(secretState(digest.toUpperCase()), "test secret");
	}

	const clean = await harness({ hosted: { ...FIXTURE, security_captcha_secret: SECRET } });
	assertEquals(clean.code, 0);
	assertFalse(clean.out.includes(SECRET));
	assertStringIncludes(rowOf(clean, "auth.captcha.secret"), "env(SUPABASE_AUTH_CAPTCHA_SECRET)");

	const test = Object.keys(TURNSTILE_TEST_SECRETS)[0];
	const pushed = await harness({ hosted: { ...FIXTURE, security_captcha_secret: test } });
	assertEquals(pushed.code, 1);
	assertStringIncludes(rowOf(pushed, "auth.captcha.secret"), "set: a Cloudflare test secret");
	assertFalse(pushed.out.includes(test));
});

Deno.test("auth:parity: the test-secret digests are the SHA-256 of the secrets", async () => {
	for (const [secret, digest] of Object.entries(TURNSTILE_TEST_SECRETS)) {
		const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
		const hex = [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");
		assertEquals(digest, hex, secret);
	}
});

Deno.test("auth:parity: the CAPTCHA secret is not required while CAPTCHA is off locally", () => {
	const off = structuredClone(CONFIG);
	(lookup(off, "auth.captcha") as Record<string, unknown>).enabled = false;
	const row = compareAuth(off, { ...FIXTURE, security_captcha_secret: null })
		.find((r) => r.key === "auth.captcha.secret");
	assert(row?.ok);
});
// #endregion

// #region The live path
Deno.test("auth:parity: one GET to the auth config endpoint, bearer token, never printed", async () => {
	const outcome = await harness({ args: [], env: LIVE_ENV });
	assertEquals(outcome.code, 0, outcome.out);
	assertEquals(outcome.requests.length, 1);
	const [{ url, init }] = outcome.requests;
	assertEquals(url, `${MANAGEMENT_API}/v1/projects/${REF}/config/auth`);
	assertEquals(init?.method, "GET");
	assertEquals(init?.body, undefined);
	assertEquals(new Headers(init?.headers).get("authorization"), `Bearer ${TOKEN}`);
	assertEquals(init?.redirect, "error");
	assertFalse(outcome.out.includes(TOKEN));
	assertStringIncludes(outcome.lines[0], `project ${REF}`);
});

Deno.test("auth:parity: --project-ref picks another environment", async () => {
	const other = "zyxwvutsrqponmlkjihg";
	const outcome = await harness({ args: ["--project-ref", other], env: LIVE_ENV });
	assertEquals(outcome.requests[0].url, `${MANAGEMENT_API}/v1/projects/${other}/config/auth`);
});

Deno.test("auth:parity: a refused token exits 2 and echoes nothing back", async () => {
	for (const status of [401, 403, 404, 500]) {
		const outcome = await harness({ args: [], env: LIVE_ENV, status, hosted: { token: TOKEN } });
		assertEquals(outcome.code, 2);
		assertStringIncludes(outcome.out, `answered ${status}`);
		assertFalse(outcome.out.includes(TOKEN));
	}
});

Deno.test("auth:parity: a network error exits 2 and the token is redacted", async () => {
	const fetchError = new TypeError(`connect failed with Bearer ${TOKEN}`);
	const outcome = await harness({ args: [], env: LIVE_ENV, fetchError });
	assertEquals(outcome.code, 2);
	assertFalse(outcome.out.includes(TOKEN));
});

Deno.test("auth:parity: missing or placeholder variables exit 2 before any request", async () => {
	const none = await harness({ args: [] });
	assertEquals(none.code, 2);
	assertStringIncludes(none.out, "SUPABASE_PROJECT_REF and SUPABASE_ACCESS_TOKEN");
	assertEquals(none.requests.length, 0);

	const placeholder = await harness({
		args: [],
		env: { SUPABASE_PROJECT_REF: REF, SUPABASE_ACCESS_TOKEN: "XXXX-XXXX" },
	});
	assertEquals(placeholder.code, 2);
	assertStringIncludes(placeholder.out, "set SUPABASE_ACCESS_TOKEN");
	assertEquals(placeholder.requests.length, 0);
});

Deno.test("auth:parity: a malformed ref is refused without echoing it", async () => {
	const pasted = "sbp_pasted_into_the_wrong_variable_0123456789";
	const outcome = await harness({
		args: [],
		env: { SUPABASE_PROJECT_REF: pasted, SUPABASE_ACCESS_TOKEN: TOKEN },
	});
	assertEquals(outcome.code, 2);
	assertEquals(outcome.requests.length, 0);
	assertFalse(outcome.out.includes(pasted));
});

Deno.test("auth:parity: a response that is not an object exits 2", async () => {
	assertEquals((await harness({ hosted: [FIXTURE] })).code, 2);
	assertEquals((await harness({ args: [], env: LIVE_ENV, hosted: "auth" })).code, 2);
});

Deno.test("auth:parity: arguments", async () => {
	assertEquals((await harness({ args: ["--help"] })).code, 0);
	assertEquals((await harness({ args: ["--fixture"] })).code, 2);
	assertEquals((await harness({ args: ["--patch"] })).code, 2);
});

Deno.test("auth:parity: the script can only send a GET", async () => {
	const source = await read("./auth-parity.ts");
	assertEquals(source.match(/method:\s*"[A-Z]+"/g), ['method: "GET"']);
	assertEquals(source.match(/\bfetch\(/g)?.length, 1);
});
// #endregion
