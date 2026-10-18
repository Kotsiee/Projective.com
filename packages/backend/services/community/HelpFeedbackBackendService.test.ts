import { assert, assertEquals } from "@std/assert";
import { SlidingWindowLimiter } from "../../core/rate-limit.ts";
import {
	HELP_FEEDBACK_GUEST_RULE,
	HELP_FEEDBACK_RULE,
	HELP_FEEDBACK_THANKS,
	HelpFeedbackBackendService,
	type HelpFeedbackRpc,
} from "./HelpFeedbackBackendService.ts";

/**
 * The "Was this helpful?" service: what it refuses before anything is written, the per-process
 * limit, the fixture road, and how the writer's answers map to statuses.
 */

const guest = { clientKey: "203.0.113.7" };
const member = { clientKey: "203.0.113.8", userId: "u-1", accessToken: "token-1" };
const limiter = () => new SlidingWindowLimiter(HELP_FEEDBACK_RULE);
const guestLimiter = () => new SlidingWindowLimiter(HELP_FEEDBACK_GUEST_RULE);
const NOW = new Date("2026-10-20T12:00:00Z");

/** A writer stub that records its calls and answers `answer`. */
function stubRpc(answer: { data: unknown; error: { code?: string; message: string } | null }) {
	const calls: Array<{ token: string | null; args: Record<string, unknown> }> = [];
	const rpc: HelpFeedbackRpc = (token, args) => {
		calls.push({ token, args });
		return Promise.resolve(answer);
	};
	return { rpc, calls };
}

Deno.test("refused before anything is written: no answer, a comment with Yes, a comment too long", async () => {
	const { rpc, calls } = stubRpc({ data: { recorded: true, duplicate: false }, error: null });
	const deps = { live: true, rpc, limiter: limiter() };
	const cases: unknown[] = [
		{ slug: "fees" },
		{ slug: "fees", helpful: true, comment: "Great" },
		{ slug: "fees", helpful: false, comment: "x".repeat(281) },
		{ slug: "Not a slug!", helpful: true },
	];
	for (const body of cases) {
		const result = await HelpFeedbackBackendService.submit(body, guest, deps);
		assertEquals(result.status, 422, JSON.stringify(body));
	}
	assertEquals(calls.length, 0);
});

Deno.test("live: a guest votes with no token; a member votes as themselves; a blank comment is none", async () => {
	const { rpc, calls } = stubRpc({ data: { recorded: true, duplicate: false }, error: null });
	const deps = { live: true, rpc, limiter: limiter() };
	const a = await HelpFeedbackBackendService.submit({ slug: "fees", helpful: true }, guest, deps);
	const b = await HelpFeedbackBackendService.submit(
		{ slug: "FEES", helpful: false, comment: "  What about refunds?  " },
		member,
		deps,
	);
	const c = await HelpFeedbackBackendService.submit(
		{ slug: "fees", helpful: false, comment: "   " },
		member,
		deps,
	);
	assert(a.ok && b.ok && c.ok);
	assertEquals(a.message, HELP_FEEDBACK_THANKS);
	assertEquals(a.data, { slug: "fees", helpful: true });
	assertEquals(calls, [
		{ token: null, args: { p_article_slug: "fees", p_helpful: true, p_comment: null } },
		{
			token: "token-1",
			args: { p_article_slug: "fees", p_helpful: false, p_comment: "What about refunds?" },
		},
		{ token: "token-1", args: { p_article_slug: "fees", p_helpful: false, p_comment: null } },
	]);
});

Deno.test("live: a duplicate vote answers the same thanks", async () => {
	const { rpc } = stubRpc({ data: { recorded: false, duplicate: true }, error: null });
	const result = await HelpFeedbackBackendService.submit(
		{ slug: "fees", helpful: true },
		member,
		{ live: true, rpc, limiter: limiter() },
	);
	assertEquals(result.status, 200);
	assertEquals(result.message, HELP_FEEDBACK_THANKS);
});

Deno.test("live: the writer's refusals map to statuses", async () => {
	const cases: Array<[string | undefined, number]> = [
		["PH404", 404],
		["PH429", 429],
		["22023", 422],
		["PGRST106", 503],
		[undefined, 503],
	];
	for (const [code, status] of cases) {
		const { rpc } = stubRpc({ data: null, error: { code, message: "refused" } });
		const result = await HelpFeedbackBackendService.submit(
			{ slug: "fees", helpful: true },
			guest,
			{ live: true, rpc, limiter: limiter() },
		);
		assertEquals(result.status, status, String(code));
	}
	const { rpc } = stubRpc({ data: { unexpected: true }, error: null });
	const drifted = await HelpFeedbackBackendService.submit(
		{ slug: "fees", helpful: true },
		guest,
		{ live: true, rpc, limiter: limiter() },
	);
	assertEquals(drifted.status, 502);
});

Deno.test("the per-process limits: per signed-in voter, and a looser one per guest address", async () => {
	const { rpc, calls } = stubRpc({ data: { recorded: true, duplicate: false }, error: null });
	const deps = { live: true, rpc, limiter: limiter(), guestLimiter: guestLimiter() };
	for (let i = 0; i < HELP_FEEDBACK_RULE.max; i++) {
		const ok = await HelpFeedbackBackendService.submit(
			{ slug: "fees", helpful: true },
			member,
			deps,
		);
		assertEquals(ok.status, 200);
	}
	const refused = await HelpFeedbackBackendService.submit(
		{ slug: "fees", helpful: true },
		member,
		deps,
	);
	assertEquals(refused.status, 429);
	assert(typeof refused.details?.retryAt === "string");
	assertEquals(calls.length, HELP_FEEDBACK_RULE.max);

	for (let i = 0; i < HELP_FEEDBACK_GUEST_RULE.max; i++) {
		const ok = await HelpFeedbackBackendService.submit(
			{ slug: "fees", helpful: true },
			guest,
			deps,
		);
		assertEquals(ok.status, 200, "a guest has their own, separate allowance");
	}
	const guestRefused = await HelpFeedbackBackendService.submit(
		{ slug: "fees", helpful: true },
		guest,
		deps,
	);
	assertEquals(guestRefused.status, 429);
});

Deno.test("fixture road: a published article is thanked, a missing one is a 404, nothing is written", async () => {
	const { rpc, calls } = stubRpc({ data: null, error: null });
	const deps = { live: false, rpc, limiter: limiter(), now: NOW };
	const known = await HelpFeedbackBackendService.submit(
		{ slug: "fees", helpful: true },
		guest,
		deps,
	);
	const missing = await HelpFeedbackBackendService.submit(
		{ slug: "no-such-article", helpful: true },
		guest,
		deps,
	);
	const early = await HelpFeedbackBackendService.submit(
		{ slug: "fees", helpful: true },
		guest,
		{ ...deps, now: new Date("2026-01-01T00:00:00Z") },
	);
	assertEquals([known.status, missing.status, early.status], [200, 404, 404]);
	assertEquals(calls.length, 0);
});
