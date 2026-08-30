import { assert, assertEquals, assertFalse } from "@std/assert";
import { isDomainLive, resolveAllDataSources, resolveDataSource } from "./data-source.ts";
import { useMocks } from "./supabase.ts";
import { MOCK_DOMAINS, MOCK_REGISTRY } from "../mocks/registry.ts";

/**
 * The contract these tests defend is the one that makes `USE_MOCKS` safe to add to a live codebase:
 *
 *   1. Absent or `false`, it changes NOTHING. Every domain resolves exactly as it did before the flag
 *      existed. This is the whole basis for calling the change non-breaking, so it is asserted rather
 *      than assumed.
 *   2. `true` forces every domain to fixtures, overriding a per-domain gate that says otherwise.
 *   3. It is one-way. There is no value of `USE_MOCKS` that turns a database path ON. A test that
 *      only checked (2) would pass against an implementation that ORed the flag in, which would let a
 *      single variable fire a half-wired money mutation at a real project.
 *
 * `serverEnv()` reads `Deno.env` lazily on every call and caches nothing, so mutating the environment
 * between assertions is enough to exercise each case — no module reloading needed.
 */

/** Run `fn` with `vars` applied, restoring the previous environment afterwards. */
function withEnv(vars: Record<string, string | undefined>, fn: () => void): void {
	const prior = new Map<string, string | undefined>();
	for (const key of Object.keys(vars)) prior.set(key, Deno.env.get(key));
	try {
		for (const [key, value] of Object.entries(vars)) {
			if (value === undefined) Deno.env.delete(key);
			else Deno.env.set(key, value);
		}
		fn();
	} finally {
		for (const [key, value] of prior) {
			if (value === undefined) Deno.env.delete(key);
			else Deno.env.set(key, value);
		}
	}
}

/** A fully-configured, fully-live environment — the only state in which any domain can be live. */
const ALL_LIVE: Record<string, string> = {
	SUPABASE_URL: "https://example.supabase.co",
	SUPABASE_ANON_KEY: "anon-key",
	AUTH_BACKEND_LIVE: "true",
	EXPLORE_BACKEND_LIVE: "true",
	PROFILE_BACKEND_LIVE: "true",
	PROJECTS_BACKEND_LIVE: "true",
	MESSAGING_BACKEND_LIVE: "true",
	CATALOGUE_BACKEND_LIVE: "true",
	NEWSLETTER_BACKEND_LIVE: "true",
	FINANCE_BACKEND_LIVE: "true",
	WORKSPACE_BACKEND_LIVE: "true",
	FILES_BACKEND_LIVE: "true",
	INTEGRATIONS_BACKEND_LIVE: "true",
	LOGGING_BACKEND_LIVE: "true",
};

Deno.test("USE_MOCKS unset is off — the pre-existing default is preserved", () => {
	withEnv({ USE_MOCKS: undefined, VITE_USE_MOCKS: undefined }, () => {
		assertFalse(useMocks(), "an unset USE_MOCKS must not force mocks");
	});
});

Deno.test("USE_MOCKS=false leaves every per-domain gate in charge", () => {
	withEnv({ ...ALL_LIVE, USE_MOCKS: "false", VITE_USE_MOCKS: undefined }, () => {
		assertFalse(useMocks());
		for (const domain of MOCK_DOMAINS) {
			assert(
				isDomainLive(domain),
				`${domain} should resolve live when its gate is on and USE_MOCKS is false`,
			);
		}
	});
});

Deno.test("USE_MOCKS=true overrides every gate, even all-live", () => {
	withEnv({ ...ALL_LIVE, USE_MOCKS: "true" }, () => {
		assert(useMocks());
		for (const report of resolveAllDataSources()) {
			assertFalse(report.isLive, `${report.domain} must be mocked when USE_MOCKS is on`);
			assertEquals(report.status, "mock:forced");
		}
	});
});

Deno.test("VITE_USE_MOCKS is honoured as an alias", () => {
	withEnv({ ...ALL_LIVE, USE_MOCKS: undefined, VITE_USE_MOCKS: "true" }, () => {
		assert(useMocks(), "VITE_USE_MOCKS must be read when USE_MOCKS is unset");
		assertEquals(resolveDataSource("explore").status, "mock:forced");
	});
});

Deno.test("USE_MOCKS wins over the alias when both are set", () => {
	// firstEnv returns the FIRST set name, and USE_MOCKS is listed first. The canonical name has to
	// win, or an alias left over in a shell profile could quietly override an explicit setting.
	withEnv({ ...ALL_LIVE, USE_MOCKS: "false", VITE_USE_MOCKS: "true" }, () => {
		assertFalse(useMocks());
	});
});

Deno.test("the switch is ONE-WAY — it can never force a domain live", () => {
	// Every gate off. No value of USE_MOCKS may produce a live domain.
	const allOff = Object.fromEntries(Object.keys(ALL_LIVE).map((k) => [k, "false"]));
	for (const value of ["true", "false", "TRUE", "1", "yes", ""]) {
		withEnv({
			...allOff,
			SUPABASE_URL: "https://example.supabase.co",
			SUPABASE_ANON_KEY: "k",
			USE_MOCKS: value,
		}, () => {
			for (const domain of MOCK_DOMAINS) {
				assertFalse(
					isDomainLive(domain),
					`USE_MOCKS="${value}" must not turn ${domain} live while its own gate is off`,
				);
			}
		});
	}
});

Deno.test("an unconfigured Supabase is reported distinctly from a closed gate", () => {
	// These look identical from the outside — both serve fixtures — but only one is a misconfiguration,
	// and collapsing them is what makes this class of problem slow to diagnose.
	withEnv({
		...ALL_LIVE,
		USE_MOCKS: "false",
		SUPABASE_URL: undefined,
		SUPABASE_ANON_KEY: undefined,
	}, () => {
		assertEquals(resolveDataSource("explore").status, "mock:unconfigured");
	});
	withEnv({
		...ALL_LIVE,
		USE_MOCKS: "false",
		EXPLORE_BACKEND_LIVE: "false",
	}, () => {
		assertEquals(resolveDataSource("explore").status, "mock:gate-off");
	});
});

Deno.test("reachesDatabase is independent of the gate and reports the honest state", () => {
	withEnv({ ...ALL_LIVE, USE_MOCKS: "false" }, () => {
		const auth = resolveDataSource("auth");
		assert(auth.isLive);
		assert(auth.reachesDatabase, "auth has a real GoTrue path");

		const catalogue = resolveDataSource("catalogue");
		assert(catalogue.isLive, "the gate resolves live");
		assertFalse(
			catalogue.reachesDatabase,
			"but CatalogueBackendService has no Supabase call, so it still serves fixtures",
		);
	});
});

Deno.test("every registry domain resolves and names a real gate", () => {
	// Guards the switch in gateValue(): a domain added to the registry without a matching case would
	// otherwise fall through and return undefined, silently reporting every environment as mocked.
	withEnv({ ...ALL_LIVE, USE_MOCKS: "false" }, () => {
		for (const domain of MOCK_DOMAINS) {
			const report = resolveDataSource(domain);
			assertEquals(report.domain, domain);
			assertEquals(report.gate, MOCK_REGISTRY[domain].gate);
			assertEquals(typeof report.isLive, "boolean");
		}
	});
});
