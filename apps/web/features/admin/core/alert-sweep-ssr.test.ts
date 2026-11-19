import { assertEquals } from "@std/assert";
import { ok } from "@server/services/ServiceResult.ts";
import { type AlertSweepDeps, answerAlertSweep } from "./alert-sweep-ssr.ts";

/*
 * POST /api/ops/cron/alerts (MR4, Decision #461): a wrong or missing bearer is a 404 that reaches
 * nothing; the right one runs one sweep with its batch bounded to 1–500.
 */

function deps(authorised: boolean, limits: number[]): AlertSweepDeps {
	return {
		isAuthorised: () => authorised,
		deliver: (limit) => {
			limits.push(limit);
			return Promise.resolve(
				ok({ folded: 0, opened: 0, silent: 0, claimed: 0, sent: 0, failed: 0 }),
			);
		},
	};
}

const req = () => new Request("http://x.test/api/ops/cron/alerts", { method: "POST" });

Deno.test("a wrong bearer is a 404 and runs no sweep", async () => {
	const limits: number[] = [];
	const res = await answerAlertSweep(
		req(),
		new URL("http://x.test/api/ops/cron/alerts"),
		deps(false, limits),
	);
	assertEquals(res.status, 404);
	assertEquals(limits, []);
});

Deno.test("the right bearer runs one sweep, its limit bounded", async () => {
	const limits: number[] = [];
	const d = deps(true, limits);
	assertEquals((await answerAlertSweep(req(), new URL("http://x.test/a?limit=50"), d)).status, 200);
	await answerAlertSweep(req(), new URL("http://x.test/a?limit=9999"), d);
	await answerAlertSweep(req(), new URL("http://x.test/a?limit=-3"), d);
	await answerAlertSweep(req(), new URL("http://x.test/a"), d);
	assertEquals(limits, [50, 500, 1, 50]);
});
