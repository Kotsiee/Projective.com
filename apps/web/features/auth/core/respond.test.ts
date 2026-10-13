import { assert, assertEquals } from "@std/assert";
import { ok } from "@server/services/ServiceResult.ts";
import { toAuthResponse } from "./respond.ts";

Deno.test("a pending-verification token becomes an HttpOnly cookie and never reaches the body", async () => {
	const res = toAuthResponse(
		ok({ requiresVerification: true, redirectTo: "/home" }, { pendingVerification: "v1.token" }),
	);
	const cookie = res.headers.get("set-cookie") ?? "";
	assert(cookie.startsWith("pj_pending_verification=v1.token;"));
	assert(cookie.includes("HttpOnly"));
	assert(cookie.includes("SameSite=Strict"));
	assert(cookie.includes("Path=/api/auth"));
	const body = await res.json();
	assertEquals(body, { ok: true, requiresVerification: true, redirectTo: "/home" });
});

Deno.test("no token, no cookie", () => {
	const res = toAuthResponse(ok({ verified: false, redirectTo: "/home" }));
	assertEquals(res.headers.get("set-cookie"), null);
});
