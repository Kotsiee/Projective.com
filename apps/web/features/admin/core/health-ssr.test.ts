import { assertEquals } from "@std/assert";
import { answerHealth, type HealthDeps } from "./health-ssr.ts";

/*
 * GET /api/ops/health (OPS5): without the bearer it is a 404 that reads nothing; with it, 200 {ok:true}
 * or 503 {ok:false}, never cached, and the body says nothing more.
 */

function deps(authorised: boolean, ok: boolean, reads: string[]): HealthDeps {
	return {
		isAuthorised: () => authorised,
		heartbeat: () => {
			reads.push("heartbeat");
			return Promise.resolve({ ok });
		},
	};
}

const req = (authorization?: string) =>
	new Request("http://x.test/api/ops/health", {
		headers: authorization ? { authorization } : {},
	});

Deno.test("no bearer, or the wrong one, is a 404 that reads nothing", async () => {
	const reads: string[] = [];
	const res = await answerHealth(req(), deps(false, true, reads));
	assertEquals(res.status, 404);
	assertEquals(res.headers.get("cache-control"), "no-store");
	assertEquals(await res.text(), "");
	assertEquals(reads, []);
});

Deno.test("a healthy platform is 200 {ok: true}; anything else 503 {ok: false}; never cached", async () => {
	const reads: string[] = [];
	const healthy = await answerHealth(req("Bearer x"), deps(true, true, reads));
	assertEquals([healthy.status, await healthy.json()], [200, { ok: true }]);
	assertEquals(healthy.headers.get("cache-control"), "no-store");
	const sick = await answerHealth(req("Bearer x"), deps(true, false, reads));
	assertEquals([sick.status, await sick.json()], [503, { ok: false }]);
	assertEquals(sick.headers.get("cache-control"), "no-store");
	assertEquals(reads.length, 2);
});

Deno.test("the live guard refuses without OPS_HEALTH_TOKEN, and with a short one", async () => {
	const prior = Deno.env.get("OPS_HEALTH_TOKEN");
	try {
		Deno.env.delete("OPS_HEALTH_TOKEN");
		assertEquals((await answerHealth(req("Bearer anything"))).status, 404);
		Deno.env.set("OPS_HEALTH_TOKEN", "short");
		assertEquals((await answerHealth(req("Bearer short"))).status, 404);
		Deno.env.set("OPS_HEALTH_TOKEN", "XXXX-XXXX");
		assertEquals((await answerHealth(req("Bearer XXXX-XXXX"))).status, 404);
	} finally {
		if (prior === undefined) Deno.env.delete("OPS_HEALTH_TOKEN");
		else Deno.env.set("OPS_HEALTH_TOKEN", prior);
	}
});
