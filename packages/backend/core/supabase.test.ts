import { assert, assertFalse, assertThrows } from "@std/assert";
import {
	CookieStore,
	getAnonClient,
	getOAuthClient,
	getServiceClient,
	getUserClient,
	isMocksForced,
	MocksForcedError,
} from "./supabase.ts";

/**
 * `USE_MOCKS` means no database (LD3, PRD-B4). The per-domain `isXBackendLive()` predicates already
 * AND in `!useMocks()`, but a service with no gate never asks them, so the guarantee has to live where
 * every database call starts: the client factories. Under `USE_MOCKS` none of them hands out a client,
 * even with a fully configured Supabase, and the refusal is a typed error a service can map to its
 * own 503.
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

const CONFIGURED: Record<string, string> = {
	SUPABASE_URL: "http://127.0.0.1:54321",
	SUPABASE_ANON_KEY: "anon-key",
	SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
};

const FACTORIES: ReadonlyArray<readonly [string, () => unknown]> = [
	["getUserClient", () => getUserClient("caller-jwt")],
	["getServiceClient", () => getServiceClient()],
	["getAnonClient", () => getAnonClient()],
	["getOAuthClient", () => getOAuthClient(new CookieStore())],
];

Deno.test("USE_MOCKS=true: no client factory hands out a client, even fully configured", () => {
	withEnv({ ...CONFIGURED, USE_MOCKS: "true", VITE_USE_MOCKS: undefined }, () => {
		for (const [name, make] of FACTORIES) {
			const error = assertThrows(make, MocksForcedError, undefined, `${name} must refuse`);
			assert(isMocksForced(error), `${name}'s refusal is recognisable as MocksForced`);
		}
	});
});

Deno.test("VITE_USE_MOCKS=true is the same refusal", () => {
	withEnv({ ...CONFIGURED, USE_MOCKS: undefined, VITE_USE_MOCKS: "true" }, () => {
		for (const [, make] of FACTORIES) assertThrows(make, MocksForcedError);
	});
});

Deno.test("USE_MOCKS off: the factories hand out clients as before", () => {
	withEnv({ ...CONFIGURED, USE_MOCKS: "false", VITE_USE_MOCKS: undefined }, () => {
		for (const [name, make] of FACTORIES) assert(make(), `${name} returns a client`);
	});
});

Deno.test("an unconfigured Supabase is still a plain configuration error, not MocksForced", () => {
	withEnv({
		USE_MOCKS: "false",
		VITE_USE_MOCKS: undefined,
		SUPABASE_URL: undefined,
		SUPABASE_ANON_KEY: undefined,
		SUPABASE_SERVICE_ROLE_KEY: undefined,
	}, () => {
		for (const [, make] of FACTORIES) {
			const error = assertThrows(make);
			assertFalse(isMocksForced(error));
		}
	});
});

Deno.test("isMocksForced recognises only the typed refusal", () => {
	assert(isMocksForced(new MocksForcedError("getServiceClient")));
	assertFalse(isMocksForced(new Error("Supabase is not configured")));
	assertFalse(isMocksForced("MocksForced"));
	assertFalse(isMocksForced(null));
});
