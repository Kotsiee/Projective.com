import { assertEquals } from "@std/assert";
import { serverEnv } from "./env.ts";

/** IW-M1 / K10: `serverEnv().appEnv` reads an unset `DENO_ENV` as production. */

function withDenoEnv(value: string | undefined, fn: () => void): void {
	const before = Deno.env.get("DENO_ENV");
	try {
		if (value === undefined) Deno.env.delete("DENO_ENV");
		else Deno.env.set("DENO_ENV", value);
		fn();
	} finally {
		if (before === undefined) Deno.env.delete("DENO_ENV");
		else Deno.env.set("DENO_ENV", before);
	}
}

Deno.test("an unset or empty DENO_ENV resolves to production", () => {
	withDenoEnv(undefined, () => assertEquals(serverEnv().appEnv, "production"));
	withDenoEnv("", () => assertEquals(serverEnv().appEnv, "production"));
});

Deno.test("an explicit DENO_ENV is taken as given", () => {
	withDenoEnv("development", () => assertEquals(serverEnv().appEnv, "development"));
	withDenoEnv("production", () => assertEquals(serverEnv().appEnv, "production"));
});

Deno.test("OPS_HEALTH_TOKEN is read as the heartbeat's bearer, and is optional (OPS5)", () => {
	const before = Deno.env.get("OPS_HEALTH_TOKEN");
	try {
		Deno.env.delete("OPS_HEALTH_TOKEN");
		assertEquals(serverEnv().opsHealthToken, undefined);
		Deno.env.set("OPS_HEALTH_TOKEN", "health-token-fixture");
		assertEquals(serverEnv().opsHealthToken, "health-token-fixture");
	} finally {
		if (before === undefined) Deno.env.delete("OPS_HEALTH_TOKEN");
		else Deno.env.set("OPS_HEALTH_TOKEN", before);
	}
});

Deno.test("the Turnstile pair is read from its canonical names", () => {
	const names = ["TURNSTILE_SITE_KEY", "TURNSTILE_SECRET_KEY"] as const;
	const before = names.map((name) => Deno.env.get(name));
	try {
		Deno.env.set("TURNSTILE_SITE_KEY", "site-key");
		Deno.env.set("TURNSTILE_SECRET_KEY", "secret-key");
		assertEquals(serverEnv().turnstileSiteKey, "site-key");
		assertEquals(serverEnv().turnstileSecretKey, "secret-key");
		for (const name of names) Deno.env.delete(name);
		assertEquals(serverEnv().turnstileSiteKey, undefined);
		assertEquals(serverEnv().turnstileSecretKey, undefined);
	} finally {
		names.forEach((name, i) => {
			const value = before[i];
			if (value === undefined) Deno.env.delete(name);
			else Deno.env.set(name, value);
		});
	}
});
