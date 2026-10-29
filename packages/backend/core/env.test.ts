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
