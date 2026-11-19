/**
 * `scripts/cron-vault-plan.ts` (OPS1): the bearer list read from registry rows, every value guard,
 * the `CRON_APP_URL` guard per target, the digest compare, the `--check` verdict, the argument parser
 * and the redactor. No database, file or network: the values here are generated per run and never
 * written anywhere.
 */
import { assert, assertEquals, assertFalse, assertStringIncludes } from "@std/assert";
import {
	appUrlProblem,
	bearersFromRegistry,
	type Capabilities,
	checkSql,
	describeLast,
	describeVerdict,
	evaluateCheck,
	type ExpectedBearer,
	hostedAppUrl,
	isPrivateHost,
	localAppUrl,
	parseArgs,
	parseDbUrl,
	parseRegistry,
	parseVaultState,
	redactor,
	type RegistryRow,
	sameDigest,
	sha256Hex,
	valueProblem,
	type VaultJobState,
	type VaultState,
	vetBearers,
} from "./cron-vault-plan.ts";

/** A fresh 48-character value, like the proof's env file. */
function value(): string {
	const bytes = new Uint8Array(24);
	crypto.getRandomValues(bytes);
	return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

const ALL: Capabilities = { registry: true, vault: true, cron: true, dispatches: true };

// #region Registry
Deno.test("the bearer list comes from the http rows, each name once, sorted, enabled or not", () => {
	const rows: RegistryRow[] = [
		{
			name: "finance-recurring-deposits",
			kind: "http",
			enabled: true,
			secretName: "FINANCE_CRON_SECRET",
		},
		{ name: "analytics-listing-rollups", kind: "sql", enabled: true, secretName: null },
		{ name: "account-erasures", kind: "http", enabled: true, secretName: "ACCOUNT_CRON_SECRET" },
		{
			name: "finance-sweep-stale-payouts",
			kind: "http",
			enabled: true,
			secretName: "FINANCE_CRON_SECRET",
		},
		{ name: "future-sweep", kind: "http", enabled: false, secretName: "FUTURE_CRON_SECRET" },
	];
	assertEquals(bearersFromRegistry(rows), [
		{ name: "ACCOUNT_CRON_SECRET", jobs: ["account-erasures"], required: true },
		{
			name: "FINANCE_CRON_SECRET",
			jobs: ["finance-recurring-deposits", "finance-sweep-stale-payouts"],
			required: true,
		},
		{ name: "FUTURE_CRON_SECRET", jobs: ["future-sweep"], required: false },
	]);
});

Deno.test("a job added to the registry adds its bearer with no edit to the tool", () => {
	const before: RegistryRow[] = [
		{ name: "ops-deliver-alerts", kind: "http", enabled: true, secretName: "OPS_CRON_SECRET" },
	];
	const after = [...before, {
		name: "search-embeddings-backfill",
		kind: "http" as const,
		enabled: true,
		secretName: "SEARCH_CRON_SECRET",
	}];
	assertEquals(bearersFromRegistry(before).map((b) => b.name), ["OPS_CRON_SECRET"]);
	assertEquals(bearersFromRegistry(after).map((b) => b.name), [
		"OPS_CRON_SECRET",
		"SEARCH_CRON_SECRET",
	]);
});

Deno.test("parseRegistry reads the registry query's rows and refuses a malformed one", () => {
	assertEquals(
		parseRegistry([{ name: "a-job", kind: "http", enabled: true, secret_name: "A_SECRET" }]),
		[{ name: "a-job", kind: "http", enabled: true, secretName: "A_SECRET" }],
	);
	let threw = false;
	try {
		parseRegistry([{ name: "a-job", kind: "cron", enabled: true, secret_name: null }]);
	} catch {
		threw = true;
	}
	assert(threw);
});
// #endregion

// #region Value guards
Deno.test("a bearer is refused when missing, the placeholder, holding whitespace or under 32", () => {
	assertEquals(valueProblem(undefined), "missing");
	assertEquals(valueProblem(""), "missing");
	assertEquals(valueProblem("XXXX-XXXX"), "placeholder");
	assertEquals(valueProblem(`xxxx-xxxx${"a".repeat(40)}`), "placeholder");
	assertEquals(valueProblem(`${value()} `), "whitespace");
	assertEquals(valueProblem(`${value().slice(0, 20)}\t${value().slice(0, 20)}`), "whitespace");
	assertEquals(valueProblem("a".repeat(31)), "short");
	assertEquals(valueProblem("a".repeat(32)), null);
	assertEquals(valueProblem(value()), null);
});

Deno.test("length counts characters, as Postgres length() does", () => {
	assertEquals(valueProblem("é".repeat(31)), "short");
	assertEquals(valueProblem("é".repeat(32)), null);
});

Deno.test("two names holding one value are both refused as duplicates", () => {
	const shared = value();
	const verdicts = vetBearers(["A_SECRET", "B_SECRET", "C_SECRET", "D_SECRET"], {
		A_SECRET: shared,
		B_SECRET: shared,
		C_SECRET: value(),
	});
	assertEquals(verdicts.map((v) => [v.name, v.problem, v.sharedWith]), [
		["A_SECRET", "duplicate", ["B_SECRET"]],
		["B_SECRET", "duplicate", ["A_SECRET"]],
		["C_SECRET", null, []],
		["D_SECRET", "missing", []],
	]);
});

Deno.test("a verdict names the bearer and the file, never the value", () => {
	const secret = value();
	const env = { A_SECRET: secret, B_SECRET: secret };
	for (const verdict of vetBearers(["A_SECRET", "B_SECRET"], env)) {
		const text = describeVerdict(verdict, ".env.staging");
		assertStringIncludes(text, verdict.name);
		assertFalse(text.includes(secret));
	}
	assertEquals(
		describeVerdict({ name: "A_SECRET", problem: "missing", sharedWith: [] }, ".env.staging"),
		".env.staging has no A_SECRET",
	);
});
// #endregion

// #region CRON_APP_URL guard
Deno.test("locally CRON_APP_URL is exactly host.docker.internal on the dev server's port", () => {
	assertEquals(localAppUrl(undefined), "http://host.docker.internal:3000");
	assertEquals(
		appUrlProblem("http://host.docker.internal:3000", { kind: "local", port: undefined }),
		null,
	);
	assertEquals(
		appUrlProblem("http://host.docker.internal:4000", { kind: "local", port: "4000" }),
		null,
	);
	assert(appUrlProblem("http://localhost:3000", { kind: "local", port: undefined }));
	assert(appUrlProblem("http://host.docker.internal:3000", { kind: "local", port: "4000" }));
	assert(appUrlProblem(null, { kind: "local", port: undefined }));
});

Deno.test("hosted CRON_APP_URL is a public https origin equal to APP_URL's", () => {
	const hosted = { kind: "hosted" as const, appUrl: "https://staging.example.com/" };
	assertEquals(appUrlProblem("https://staging.example.com", hosted), null);
	assertEquals(appUrlProblem("https://staging.example.com/", hosted), null);
	assertStringIncludes(appUrlProblem("http://staging.example.com", hosted) ?? "", "not https");
	assertStringIncludes(
		appUrlProblem("https://staging.example.com/api", hosted) ?? "",
		"bare origin",
	);
	assertStringIncludes(
		appUrlProblem("https://u:p@staging.example.com", hosted) ?? "",
		"credentials",
	);
	assertStringIncludes(
		appUrlProblem("https://other.example.com", hosted) ?? "",
		"APP_URL's origin",
	);
	assertStringIncludes(
		appUrlProblem("https://staging.example.com", { kind: "hosted", appUrl: undefined }) ?? "",
		"APP_URL is unset",
	);
	for (
		const url of [
			"https://host.docker.internal",
			"https://127.0.0.1",
			"https://10.0.0.8",
			"https://[::1]",
			"https://[::ffff:127.0.0.1]",
			"https://2130706433",
		]
	) {
		assertStringIncludes(appUrlProblem(url, { kind: "hosted", appUrl: url }) ?? "", "private");
	}
});

Deno.test("loopback, private, link-local and Docker hosts are private; public ones are not", () => {
	for (
		const host of [
			"localhost",
			"app.localhost",
			"host.docker.internal",
			"gateway.docker.internal",
			"printer.local",
			"127.0.0.1",
			"10.1.2.3",
			"172.16.0.1",
			"172.31.255.255",
			"192.168.0.1",
			"169.254.169.254",
			"100.64.0.1",
			"0.0.0.0",
			"[::1]",
			"::",
			"fd12::1",
			"fe80::1",
			"::ffff:10.0.0.1",
			"[::ffff:7f00:1]",
			"::ffff:c0a8:101",
		]
	) assert(isPrivateHost(host), host);
	for (
		const host of [
			"staging.example.com",
			"8.8.8.8",
			"172.32.0.1",
			"2606:4700::1111",
			"::ffff:8.8.8.8",
			"::ffff:808:808",
		]
	) {
		assertFalse(isPrivateHost(host), host);
	}
});

Deno.test("an env file's CRON_APP_URL defaults to APP_URL's origin", () => {
	assertEquals(
		hostedAppUrl({ APP_URL: "https://staging.example.com/path" }),
		"https://staging.example.com",
	);
	assertEquals(
		hostedAppUrl({ APP_URL: "https://a.example.com", CRON_APP_URL: "https://b.example.com" }),
		"https://b.example.com",
	);
	assertEquals(hostedAppUrl({}), undefined);
});
// #endregion

// #region Digest compare
Deno.test("the Deno digest is the hex sha256 Postgres computes, over UTF-8 bytes", async () => {
	// Both values read back from `encode(sha256(convert_to(v, 'UTF8')), 'hex')` on Postgres 17.
	assertEquals(
		await sha256Hex("abc"),
		"ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
	);
	assertEquals(
		await sha256Hex("é"),
		"4a99557e4033c3539de2eb65472017cad5f9557f7a0625a09f1c3f6e2ba69c4c",
	);
});

Deno.test("digests compare equal only when both are present and identical", async () => {
	const a = await sha256Hex(value());
	const b = await sha256Hex(value());
	assert(sameDigest(a, a));
	assertFalse(sameDigest(a, b));
	assertFalse(sameDigest(a, null));
	assertFalse(sameDigest(null, null));
	assertFalse(sameDigest(a, a.slice(1)));
});
// #endregion

// #region SQL
Deno.test("the check query computes the digest in the database and names nothing absent", () => {
	const sql = checkSql(ALL);
	assertStringIncludes(sql, "pg_catalog.sha256(pg_catalog.convert_to(s.decrypted_secret, 'UTF8'))");
	assertStringIncludes(sql, "LEFT JOIN cron.job c");
	assertStringIncludes(sql, "WHERE j.kind = 'http' AND j.enabled");
	const bare = checkSql({ registry: true, vault: false, cron: false, dispatches: false });
	assertFalse(bare.includes("vault."));
	assertFalse(bare.includes("cron.job"));
	assertFalse(bare.includes("http_job_dispatches"));
});
// #endregion

// #region Check verdict
async function readyJob(name: string, secretName: string, secret: string): Promise<VaultJobState> {
	return {
		name,
		secretName,
		present: true,
		length: secret.length,
		digest: await sha256Hex(secret),
		secretUpdatedAt: "2026-11-19T10:00:00+00:00",
		cron: true,
		cronActive: true,
		last: null,
	};
}

async function expectedFor(secret: string): Promise<ExpectedBearer> {
	return { digest: await sha256Hex(secret), problem: null };
}

const HOSTED = { kind: "hosted" as const, appUrl: "https://staging.example.com" };

Deno.test("--check is ready when every bearer is present, long enough, equal and scheduled", async () => {
	const finance = value();
	const account = value();
	const state: VaultState = {
		appUrl: "https://staging.example.com",
		capabilities: ALL,
		jobs: [
			await readyJob("account-erasures", "ACCOUNT_CRON_SECRET", account),
			await readyJob("finance-recurring-deposits", "FINANCE_CRON_SECRET", finance),
		],
	};
	const expected = new Map([
		["ACCOUNT_CRON_SECRET", await expectedFor(account)],
		["FINANCE_CRON_SECRET", await expectedFor(finance)],
	]);
	const result = evaluateCheck(state, expected, HOSTED, ".env.staging");
	assert(result.ready);
	assertEquals(result.lines.filter((l) => l.startsWith("ready")).length, 3);
	assertStringIncludes(result.lines.at(-1) ?? "", "2 of 2 enabled http jobs ready");
	for (const line of result.lines) {
		assertFalse(line.includes(finance) || line.includes(account));
	}
});

Deno.test("a missing secret fails the check, naming the job and the secret", async () => {
	const account = value();
	const missing: VaultJobState = {
		...(await readyJob("finance-recurring-deposits", "FINANCE_CRON_SECRET", value())),
		present: false,
		length: null,
		digest: null,
	};
	const state: VaultState = {
		appUrl: "https://staging.example.com",
		capabilities: ALL,
		jobs: [await readyJob("account-erasures", "ACCOUNT_CRON_SECRET", account), missing],
	};
	const expected = new Map([
		["ACCOUNT_CRON_SECRET", await expectedFor(account)],
		["FINANCE_CRON_SECRET", await expectedFor(value())],
	]);
	const result = evaluateCheck(state, expected, HOSTED, ".env.staging");
	assertFalse(result.ready);
	const line = result.lines.find((l) => l.includes("finance-recurring-deposits")) ?? "";
	assert(line.startsWith("NOT READY"));
	assertStringIncludes(line, "FINANCE_CRON_SECRET is not in Vault");
	assertStringIncludes(
		result.lines.at(-1) ?? "",
		"finance-recurring-deposits (FINANCE_CRON_SECRET)",
	);
});

Deno.test("a value that differs from the env file fails with 'differs', printing neither", async () => {
	const inVault = value();
	const inFile = value();
	const state: VaultState = {
		appUrl: "https://staging.example.com",
		capabilities: ALL,
		jobs: [await readyJob("account-erasures", "ACCOUNT_CRON_SECRET", inVault)],
	};
	const result = evaluateCheck(
		state,
		new Map([["ACCOUNT_CRON_SECRET", await expectedFor(inFile)]]),
		HOSTED,
		".env.staging",
	);
	assertFalse(result.ready);
	const text = result.lines.join("\n");
	assertStringIncludes(text, "ACCOUNT_CRON_SECRET in Vault differs from .env.staging");
	assertFalse(text.includes(inVault) || text.includes(inFile));
});

Deno.test("a short Vault value, no cron entry and an inactive one each fail the check", async () => {
	const secret = value();
	const expected = new Map([["A_SECRET", await expectedFor(secret)]]);
	const base = await readyJob("a-job", "A_SECRET", secret);
	const cases: [Partial<VaultJobState>, string][] = [
		[{ length: 12 }, "12 characters in Vault"],
		[{ length: null }, "does not decrypt"],
		[{ cron: false }, "no cron.job entry"],
		[{ cronActive: false }, "inactive"],
	];
	for (const [patch, reason] of cases) {
		const state: VaultState = {
			appUrl: "https://staging.example.com",
			capabilities: ALL,
			jobs: [{ ...base, ...patch }],
		};
		const result = evaluateCheck(state, expected, HOSTED, ".env.staging");
		assertFalse(result.ready, reason);
		assertStringIncludes(result.lines.join("\n"), reason);
	}
});

Deno.test("an env file without the bearer fails the check for its jobs", async () => {
	const state: VaultState = {
		appUrl: "https://staging.example.com",
		capabilities: ALL,
		jobs: [await readyJob("a-job", "A_SECRET", value())],
	};
	const result = evaluateCheck(state, new Map(), HOSTED, ".env.staging");
	assertFalse(result.ready);
	assertStringIncludes(result.lines.join("\n"), ".env.staging has no A_SECRET");
});

Deno.test("CRON_APP_URL missing or private fails the check; its origin is printed when ready", async () => {
	const secret = value();
	const expected = new Map([["A_SECRET", await expectedFor(secret)]]);
	const job = await readyJob("a-job", "A_SECRET", secret);
	const missing = evaluateCheck(
		{ appUrl: null, capabilities: ALL, jobs: [job] },
		expected,
		HOSTED,
		".env.staging",
	);
	assertFalse(missing.ready);
	assertStringIncludes(missing.lines[0], "CRON_APP_URL is not in Vault");
	const local = evaluateCheck(
		{ appUrl: "http://host.docker.internal:3000", capabilities: ALL, jobs: [job] },
		expected,
		HOSTED,
		".env.staging",
	);
	assertFalse(local.ready);
	assertStringIncludes(local.lines[0], "not https");
	const ok = evaluateCheck(
		{ appUrl: "https://staging.example.com", capabilities: ALL, jobs: [job] },
		expected,
		HOSTED,
		".env.staging",
	);
	assertStringIncludes(ok.lines[0], "https://staging.example.com");
});

Deno.test("a refusal after the value was written fails the check; one before it or a 5xx does not", async () => {
	const secret = value();
	const expected = new Map([["A_SECRET", await expectedFor(secret)]]);
	const base = await readyJob("a-job", "A_SECRET", secret);
	const at = (dispatchedAt: string, statusCode: number) => ({
		dispatchedAt,
		settledAt: dispatchedAt,
		statusCode,
		error: null,
	});
	const after = evaluateCheck(
		{
			appUrl: "https://staging.example.com",
			capabilities: ALL,
			jobs: [{ ...base, last: at("2026-11-19T10:05:00+00:00", 404) }],
		},
		expected,
		HOSTED,
		".env.staging",
	);
	assertFalse(after.ready);
	assertStringIncludes(after.lines.join("\n"), "the app answered 404");
	for (const last of [at("2026-11-19T09:55:00+00:00", 404), at("2026-11-19T10:05:00+00:00", 503)]) {
		const result = evaluateCheck(
			{ appUrl: "https://staging.example.com", capabilities: ALL, jobs: [{ ...base, last }] },
			expected,
			HOSTED,
			".env.staging",
		);
		assert(result.ready, describeLast(last));
	}
});

Deno.test("without pg_cron or Vault every job is not ready, and says why", async () => {
	const secret = value();
	const job = await readyJob("a-job", "A_SECRET", secret);
	const result = evaluateCheck(
		{
			appUrl: "https://staging.example.com",
			capabilities: { registry: true, vault: true, cron: false, dispatches: true },
			jobs: [{ ...job, cron: false, cronActive: null }],
		},
		new Map([["A_SECRET", await expectedFor(secret)]]),
		HOSTED,
		".env.staging",
	);
	assertFalse(result.ready);
	assertStringIncludes(result.lines.join("\n"), "pg_cron is not installed");
});

Deno.test("the last outcome reads as never, pending, failed or a status", () => {
	assertEquals(describeLast(null), "never dispatched");
	assertEquals(
		describeLast({
			dispatchedAt: "2026-11-19T10:15:42+00:00",
			settledAt: null,
			statusCode: null,
			error: null,
		}),
		"dispatched 2026-11-19 10:15Z, no answer yet",
	);
	assertEquals(
		describeLast({
			dispatchedAt: "2026-11-19T10:15:42+00:00",
			settledAt: "2026-11-19T10:15:43+00:00",
			statusCode: null,
			error: "Couldn't resolve host name",
		}),
		"failed 2026-11-19 10:15Z: Couldn't resolve host name",
	);
	assertEquals(
		describeLast({
			dispatchedAt: "2026-11-19T10:15:42+00:00",
			settledAt: "2026-11-19T10:15:43+00:00",
			statusCode: 200,
			error: null,
		}),
		"200 at 2026-11-19 10:15Z",
	);
});

Deno.test("parseVaultState reads the check document", () => {
	const state = parseVaultState({
		app_url: "https://staging.example.com",
		jobs: [{
			name: "a-job",
			secret_name: "A_SECRET",
			present: true,
			length: 48,
			digest: "ab",
			secret_updated_at: "2026-11-19T10:00:00+00:00",
			cron: true,
			cron_active: true,
			last: null,
		}],
	}, ALL);
	assertEquals(state.jobs[0].length, 48);
	assertEquals(state.jobs[0].last, null);
	assertEquals(state.appUrl, "https://staging.example.com");
});
// #endregion

// #region Arguments
Deno.test("the modes parse, and a stray argument is refused without being echoed", () => {
	assertEquals(parseArgs([]), { kind: "default" });
	assertEquals(parseArgs(["--all"]), { kind: "all" });
	assertEquals(parseArgs(["--check"]), { kind: "check-local" });
	assertEquals(parseArgs(["--env-file", ".env.staging"]), {
		kind: "write-env",
		envFile: ".env.staging",
	});
	assertEquals(parseArgs(["--check", "--env-file", ".env.staging"]), {
		kind: "check-env",
		envFile: ".env.staging",
	});
	assertEquals(parseArgs(["--help"]), { kind: "help" });
	const secret = value();
	const stray = parseArgs([secret]);
	assert("error" in stray);
	assertFalse(stray.error.includes(secret));
	assert("error" in parseArgs(["--env-file"]));
	assert("error" in parseArgs(["--all", "--env-file", "x"]));
	assert("error" in parseArgs(["--all", "--check"]));
	assert("error" in parseArgs(["--env-file", "a", "--env-file", "b"]));
});
// #endregion

// #region Connection string
Deno.test("CRON_VAULT_DB_URL parses, labels without the password and marks loopback", () => {
	const password = value();
	const parsed = parseDbUrl(
		`postgresql://postgres.ref:${password}@aws-0-eu.pooler.supabase.com:5432/postgres`,
	);
	assert(!("problem" in parsed));
	assertEquals(parsed.user, "postgres.ref");
	assertEquals(parsed.password, password);
	assertEquals(parsed.label, "aws-0-eu.pooler.supabase.com:5432/postgres");
	assertFalse(parsed.loopback);
	const local = parseDbUrl(`postgres://postgres:${password}@127.0.0.1:54399/postgres`);
	assert(!("problem" in local) && local.loopback);
	for (const bad of [undefined, "XXXX-XXXX", "not a url", `mysql://u:${password}@h/db`]) {
		const result = parseDbUrl(bad);
		assert("problem" in result);
		assertFalse(result.problem.includes(password));
	}
});
// #endregion

// #region Redaction
Deno.test("the redactor removes every listed value from a line", () => {
	const a = value();
	const b = value();
	const redact = redactor([a, b, undefined, ""]);
	assertEquals(redact(`x ${a} y ${b} z ${a}`), "x [redacted] y [redacted] z [redacted]");
	assertEquals(redact("nothing here"), "nothing here");
});
// #endregion
