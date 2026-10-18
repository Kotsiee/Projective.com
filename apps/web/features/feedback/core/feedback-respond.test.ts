import { assertEquals } from "@std/assert";
import { fail, ok } from "@server/services/ServiceResult.ts";
import { feedbackNotFound, feedbackResponse } from "./feedback-respond.ts";

Deno.test("an answer is the flat envelope at the service's status, never cached", async () => {
	const res = feedbackResponse(ok({ voted: true, voteCount: 3 }));
	assertEquals(res.status, 200);
	assertEquals(res.headers.get("cache-control"), "private, no-store");
	assertEquals(await res.json(), { ok: true, voted: true, voteCount: 3 });
});

Deno.test("a 429 carries Retry-After from details.retryAt", async () => {
	const retryAt = new Date(Date.now() + 90_000).toISOString();
	const res = feedbackResponse(fail(429, { message: "Slow down.", details: { retryAt } }));
	assertEquals(res.status, 429);
	const seconds = Number(res.headers.get("retry-after"));
	assertEquals(seconds > 80 && seconds <= 90, true);
	assertEquals((await res.json()).details, { retryAt });
});

Deno.test("a refusal keeps its field errors; a non-idea address is a plain 404", async () => {
	const res = feedbackResponse(
		fail(422, { message: "Check it.", errors: { title: "Too short." } }),
	);
	assertEquals((await res.json()).errors, { title: "Too short." });
	assertEquals(res.headers.get("retry-after"), null);
	const missing = feedbackNotFound();
	assertEquals(missing.status, 404);
	assertEquals((await missing.json()).ok, false);
});
