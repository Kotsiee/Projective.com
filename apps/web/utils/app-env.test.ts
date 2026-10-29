import { assertEquals } from "@std/assert";
import { appEnv, isDevelopmentEnv, isProductionEnv } from "./app-env.ts";
import { isRestrictedRequest } from "./age-gate.ts";

/** IW-M1 / K10: an unset `DENO_ENV` means production, so no dev cookie is honoured. */

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

const MINOR_COOKIE = new Request("http://localhost/", { headers: { cookie: "pj.dev.age=minor" } });

Deno.test("unset or empty DENO_ENV is production, and the dev age cookie is ignored", () => {
	for (const value of [undefined, ""]) {
		withDenoEnv(value, () => {
			assertEquals(appEnv(), "production");
			assertEquals(isProductionEnv(), true);
			assertEquals(isDevelopmentEnv(), false);
			assertEquals(isRestrictedRequest(MINOR_COOKIE, null), false);
		});
	}
});

Deno.test("development must be named; any other value is not development", () => {
	withDenoEnv("Development", () => {
		assertEquals(isDevelopmentEnv(), true);
		assertEquals(isProductionEnv(), false);
		assertEquals(isRestrictedRequest(MINOR_COOKIE, null), true);
	});
	withDenoEnv("staging", () => {
		assertEquals(isDevelopmentEnv(), false);
		assertEquals(isProductionEnv(), false);
	});
});
