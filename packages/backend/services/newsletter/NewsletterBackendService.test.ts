import { assert, assertEquals } from "@std/assert";
import { SlidingWindowLimiter } from "../../core/rate-limit.ts";
import {
	NEWSLETTER_SUBSCRIBE_RULE,
	NEWSLETTER_UNAVAILABLE_MESSAGE,
	NewsletterBackendService,
	type NewsletterSubscribeRpc,
} from "./NewsletterBackendService.ts";

/**
 * The fat newsletter service around its writer: what it sends `community.subscribe_newsletter`, how it
 * maps each answer, that the stub path answers the live writer's first-subscribe outcome in
 * development, and that production refuses rather than confirm a write it skipped. The writer itself
 * is pinned by `supabase/probes/community_editorial_schemas.sql`.
 */

/** A fresh limiter per test, so one test's attempts never refuse another's. */
const limiter = () => new SlidingWindowLimiter(NEWSLETTER_SUBSCRIBE_RULE);

/** An in-memory stand-in for the writer, deciding exactly as the SQL does. */
function fakeWriter(): { rpc: NewsletterSubscribeRpc; calls: Record<string, string>[] } {
	const rows = new Map<string, string[]>();
	const calls: Record<string, string>[] = [];
	const rpc: NewsletterSubscribeRpc = (args) => {
		calls.push(args);
		const held = rows.get(args.p_email);
		let outcome: string;
		if (!held) {
			rows.set(args.p_email, [args.p_topic]);
			outcome = "created";
		} else if (held.includes(args.p_topic)) {
			outcome = "unchanged";
		} else {
			rows.set(args.p_email, [...held, args.p_topic].sort());
			outcome = "topic_added";
		}
		return Promise.resolve({
			data: {
				email: args.p_email,
				topic: args.p_topic,
				outcome,
				already_subscribed: outcome === "unchanged",
			},
			error: null,
		});
	};
	return { rpc, calls };
}

Deno.test("stub path: accepts, echoes the normalised address and the default topic, writes nothing", async () => {
	const result = await NewsletterBackendService.subscribe(
		{ email: "  Reader@Example.com " },
		{ live: false, production: false, limiter: limiter() },
	);
	assert(result.ok);
	assertEquals(result.status, 200);
	assertEquals(result.data, {
		email: "reader@example.com",
		topic: "general",
		alreadySubscribed: false,
	});
});

Deno.test("stub path (production): refuses with 503 rather than confirm a subscription it never stored", async () => {
	const { rpc, calls } = fakeWriter();
	for (const topic of ["general", "changelog"]) {
		const result = await NewsletterBackendService.subscribe(
			{ email: "reader@example.com", topic },
			{ live: false, production: true, rpc, limiter: limiter() },
		);
		assertEquals(result.ok, false);
		assertEquals(result.status, 503);
		assertEquals(result.message, NEWSLETTER_UNAVAILABLE_MESSAGE);
		assertEquals(result.data, undefined);
	}
	// Nothing reached the writer, and nothing claimed it did.
	assertEquals(calls, []);
});

Deno.test("live path (production): the gate on, production writes as usual", async () => {
	const { rpc, calls } = fakeWriter();
	const result = await NewsletterBackendService.subscribe(
		{ email: "reader@example.com" },
		{ live: true, production: true, rpc, limiter: limiter() },
	);
	assert(result.ok);
	assertEquals(calls.length, 1);
});

Deno.test("live path: sends the normalised address, source and topic to the writer", async () => {
	const { rpc, calls } = fakeWriter();
	await NewsletterBackendService.subscribe(
		{ email: "Reader@Example.com", source: "landing", topic: "changelog" },
		{ live: true, rpc, limiter: limiter() },
	);
	assertEquals(calls, [{
		p_email: "reader@example.com",
		p_source: "landing",
		p_topic: "changelog",
	}]);
});

Deno.test("live path: re-subscribing with a new topic adds it; repeating it is idempotent", async () => {
	const { rpc } = fakeWriter();
	const deps = { live: true, rpc, limiter: limiter() };
	const first = await NewsletterBackendService.subscribe({ email: "r@example.com" }, deps);
	const added = await NewsletterBackendService.subscribe(
		{ email: "r@example.com", topic: "changelog" },
		deps,
	);
	const again = await NewsletterBackendService.subscribe(
		{ email: "r@example.com", topic: "changelog" },
		deps,
	);
	assertEquals(first.data?.alreadySubscribed, false);
	assertEquals(added.data, {
		email: "r@example.com",
		topic: "changelog",
		alreadySubscribed: false,
	});
	assertEquals(again.data, { email: "r@example.com", topic: "changelog", alreadySubscribed: true });
	// Every outcome answers the same success line, so the message never tells outcomes apart.
	assertEquals(new Set([first.message, added.message, again.message]).size, 1);
});

Deno.test("live path: a database error is a retryable 503, never a false success", async () => {
	const rpc: NewsletterSubscribeRpc = () =>
		Promise.resolve({ data: null, error: { code: "PGRST106", message: "schema not exposed" } });
	const result = await NewsletterBackendService.subscribe(
		{ email: "r@example.com" },
		{ live: true, rpc, limiter: limiter() },
	);
	assertEquals(result.ok, false);
	assertEquals(result.status, 503);
	assertEquals(result.details, { code: "PGRST106" });
});

Deno.test("live path: the writer's address guard maps to the email field", async () => {
	const rpc: NewsletterSubscribeRpc = () =>
		Promise.resolve({ data: null, error: { code: "22023", message: "bad address" } });
	const result = await NewsletterBackendService.subscribe(
		{ email: "r@example.com" },
		{ live: true, rpc, limiter: limiter() },
	);
	assertEquals(result.status, 422);
	assert(result.errors?.email);
});

Deno.test("an address with a NUL or a lone surrogate is a 422 before the writer, and after it", async () => {
	let calls = 0;
	const reached: NewsletterSubscribeRpc = () => {
		calls++;
		return Promise.resolve({ data: null, error: null });
	};
	for (const bad of ["\u0000", "\ud800"]) {
		const result = await NewsletterBackendService.subscribe(
			{ email: `r${bad}.1@example.com` },
			{ live: true, rpc: reached, limiter: limiter() },
		);
		assertEquals(result.status, 422);
		assertEquals(result.errors?.email, "Enter a valid email address.");
	}
	assertEquals(calls, 0, "the schema refuses it; the writer is never called");
	for (const code of ["22P05", "PGRST102"]) {
		const rpc: NewsletterSubscribeRpc = () =>
			Promise.resolve({ data: null, error: { code, message: "unreadable" } });
		const result = await NewsletterBackendService.subscribe(
			{ email: "r@example.com" },
			{ live: true, rpc, limiter: limiter() },
		);
		assertEquals(result.status, 422, `${code} is malformed input, not an outage`);
		assert(result.errors?.email);
	}
});

Deno.test("live path: a drifted writer answer is refused (502)", async () => {
	const rpc: NewsletterSubscribeRpc = () =>
		Promise.resolve({ data: { email: "r@example.com", outcome: "added" }, error: null });
	const result = await NewsletterBackendService.subscribe(
		{ email: "r@example.com" },
		{ live: true, rpc, limiter: limiter() },
	);
	assertEquals(result.status, 502);
});

Deno.test("an unknown topic is a 422 on the topic field, before any write", async () => {
	const { rpc, calls } = fakeWriter();
	const result = await NewsletterBackendService.subscribe(
		{ email: "r@example.com", topic: "weekly" },
		{ live: true, rpc, limiter: limiter() },
	);
	assertEquals(result.status, 422);
	assert(result.errors?.topic);
	assertEquals(calls.length, 0);
});

Deno.test("an address over 254 characters is a 422 on the email field, before any write", async () => {
	const { rpc, calls } = fakeWriter();
	const result = await NewsletterBackendService.subscribe(
		{ email: `${"a".repeat(6400)}@example.com` },
		{ live: true, rpc, limiter: limiter() },
	);
	assertEquals(result.status, 422);
	assert(result.errors?.email);
	assertEquals(calls.length, 0);
});

Deno.test("the per-address limit refuses the sixth attempt in the window with a retry time", async () => {
	const { rpc } = fakeWriter();
	const deps = { live: true, rpc, limiter: limiter() };
	for (let i = 0; i < NEWSLETTER_SUBSCRIBE_RULE.max; i++) {
		const ok = await NewsletterBackendService.subscribe({ email: "busy@example.com" }, deps);
		assert(ok.ok);
	}
	const refused = await NewsletterBackendService.subscribe({ email: "BUSY@example.com" }, deps);
	assertEquals(refused.status, 429);
	assert(typeof refused.details?.retryAt === "string");
	const other = await NewsletterBackendService.subscribe({ email: "calm@example.com" }, deps);
	assert(other.ok, "another address is unaffected");
});
