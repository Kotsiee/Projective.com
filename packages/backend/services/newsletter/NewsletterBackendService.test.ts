import { assert, assertEquals, assertFalse } from "@std/assert";
import { CAPTCHA_REFUSAL } from "@projective/types/auth";
import { SlidingWindowLimiter } from "../../core/rate-limit.ts";
import { TURNSTILE_TEST_KEYS } from "../../core/turnstile.ts";
import { checkJoinCaptcha } from "../auth/captcha.ts";
import type { NewsletterConfirmationMail } from "./newsletter-mailer.ts";
import {
	NEWSLETTER_CONFIRM_RULE,
	NEWSLETTER_LINK_EXPIRED_MESSAGE,
	NEWSLETTER_SUBSCRIBE_RULE,
	NEWSLETTER_SUBSCRIBED_MESSAGE,
	NEWSLETTER_UNAVAILABLE_MESSAGE,
	NewsletterBackendService,
	type NewsletterCaptchaGate,
	type NewsletterRpc,
	type NewsletterSubscribeRpc,
} from "./NewsletterBackendService.ts";

/**
 * The fat newsletter service around its doors: what it sends `community.subscribe_newsletter`, the
 * bot check before it, the confirmation mail after it, the one public success every subscribe
 * answers, and the mailed link's read, confirm and unsubscribe. The doors themselves are pinned by
 * `supabase/probes/newsletter_double_opt_in.sql` and `community_editorial_schemas.sql`.
 */

// #region Harness
/** A fresh limiter per test, so one test's attempts never refuse another's. */
const limiter = () => new SlidingWindowLimiter(NEWSLETTER_SUBSCRIBE_RULE);

/** A bot check that admits everything, for the tests about what comes after it. */
const pass: NewsletterCaptchaGate = () => Promise.resolve(null);

const TOKEN = "0b0e7d5c-34a1-4b7a-9d61-2f1f5c2e9a10";

/** An in-memory stand-in for the writer: a new address or a new topic is due a mail, a repeat not. */
function fakeWriter(): {
	rpc: NewsletterSubscribeRpc;
	calls: Record<string, string>[];
	mails: NewsletterConfirmationMail[];
	mailer: (mail: NewsletterConfirmationMail) => Promise<void>;
} {
	const rows = new Map<string, string[]>();
	const calls: Record<string, string>[] = [];
	const mails: NewsletterConfirmationMail[] = [];
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
		const due = outcome !== "unchanged";
		return Promise.resolve({
			data: {
				email: args.p_email,
				topic: args.p_topic,
				outcome,
				already_subscribed: outcome === "unchanged",
				confirmation_due: due,
				token: due ? TOKEN : null,
				confirm_topics: due ? rows.get(args.p_email) : null,
			},
			error: null,
		});
	};
	const mailer = (mail: NewsletterConfirmationMail) => {
		mails.push(mail);
		return Promise.resolve();
	};
	return { rpc, calls, mails, mailer };
}

/** Live deps around a fresh fake writer. */
function live(extra: Record<string, unknown> = {}) {
	const writer = fakeWriter();
	return {
		writer,
		deps: {
			live: true,
			rpc: writer.rpc,
			mailer: writer.mailer,
			limiter: limiter(),
			captcha: pass,
			appUrl: "https://app.example.test",
			...extra,
		},
	};
}

/** A link door answering `data`, recording what it was asked. */
function door(data: unknown, error: { code?: string; message: string } | null = null) {
	const calls: Record<string, unknown>[] = [];
	const rpc: NewsletterRpc<Record<string, unknown>> = (args) => {
		calls.push(args);
		return Promise.resolve({ data, error });
	};
	return { rpc, calls };
}
// #endregion

// #region Subscribe
Deno.test("stub path: accepts and echoes the normalised address and the default topic, mailing nothing", async () => {
	const result = await NewsletterBackendService.subscribe(
		{ email: "  Reader@Example.com " },
		{ live: false, production: false, limiter: limiter(), captcha: pass },
	);
	assert(result.ok);
	assertEquals(result.status, 200);
	assertEquals(result.data, { email: "reader@example.com", topic: "general" });
	assertEquals(result.message, NEWSLETTER_SUBSCRIBED_MESSAGE);
});

Deno.test("stub path (production): refuses with 503 rather than confirm a subscription it never stored", async () => {
	const { rpc, calls } = fakeWriter();
	for (const topic of ["general", "changelog"]) {
		const result = await NewsletterBackendService.subscribe(
			{ email: "reader@example.com", topic },
			{ live: false, production: true, rpc, limiter: limiter(), captcha: pass },
		);
		assertEquals(result.ok, false);
		assertEquals(result.status, 503);
		assertEquals(result.message, NEWSLETTER_UNAVAILABLE_MESSAGE);
		assertEquals(result.data, undefined);
	}
	assertEquals(calls, []);
});

Deno.test("live path (production): the gate on, production writes as usual", async () => {
	const { writer, deps } = live({ production: true });
	const result = await NewsletterBackendService.subscribe({ email: "reader@example.com" }, deps);
	assert(result.ok);
	assertEquals(writer.calls.length, 1);
});

Deno.test("live path: sends the normalised address, source and topic to the writer", async () => {
	const { writer, deps } = live();
	await NewsletterBackendService.subscribe(
		{ email: "Reader@Example.com", source: "landing", topic: "changelog", captchaToken: "tok" },
		deps,
	);
	assertEquals(writer.calls, [{
		p_email: "reader@example.com",
		p_source: "landing",
		p_topic: "changelog",
	}]);
});

Deno.test("a due confirmation is mailed after the write, with the token and the topics to confirm", async () => {
	const { writer, deps } = live();
	await NewsletterBackendService.subscribe({ email: "r@example.com" }, deps);
	await NewsletterBackendService.subscribe({ email: "r@example.com", topic: "changelog" }, deps);
	assertEquals(writer.mails, [
		{ to: "r@example.com", token: TOKEN, topics: ["general"], appUrl: "https://app.example.test" },
		{
			to: "r@example.com",
			token: TOKEN,
			topics: ["changelog", "general"],
			appUrl: "https://app.example.test",
		},
	]);
});

Deno.test("every subscribe answers the same success, mailed or not: no enumeration", async () => {
	const { writer, deps } = live();
	const first = await NewsletterBackendService.subscribe({ email: "r@example.com" }, deps);
	const again = await NewsletterBackendService.subscribe({ email: "r@example.com" }, deps);
	assertEquals(writer.mails.length, 1, "the repeat is not due a mail");
	assertEquals(first.status, again.status);
	assertEquals(first.message, again.message);
	assertEquals(first.data, again.data);
	assertEquals(Object.keys(first.data ?? {}).sort(), ["email", "topic"]);
	assertFalse(JSON.stringify(first).includes(TOKEN), "the token never leaves the server");
});

Deno.test("a subscribe without a Turnstile token is refused before the writer", async () => {
	const { writer, deps } = live({
		captcha: ((token) =>
			checkJoinCaptcha({
				token,
				keys: { siteKey: "site", secretKey: "a-real-secret" },
				action: "newsletter",
				remoteIp: null,
				allowedHostnames: [],
				development: false,
				fetchImpl: () => Promise.reject(new Error("siteverify must not be reached")),
			})) satisfies NewsletterCaptchaGate,
	});
	const result = await NewsletterBackendService.subscribe({ email: "r@example.com" }, deps);
	assertEquals(result.status, 400);
	assertEquals(result.message, CAPTCHA_REFUSAL);
	assertEquals(writer.calls, []);
	assertEquals(writer.mails, []);
});

Deno.test("a token Cloudflare refuses is refused too; the test pair passes only in development", async () => {
	const siteverify = (success: boolean) => () =>
		Promise.resolve(
			Response.json({ success, metadata: { result_with_testing_key: true } }),
		);
	const gate = (development: boolean, success: boolean): NewsletterCaptchaGate => (token) =>
		checkJoinCaptcha({
			token,
			keys: { siteKey: TURNSTILE_TEST_KEYS.site.pass, secretKey: TURNSTILE_TEST_KEYS.secret.pass },
			action: "newsletter",
			remoteIp: null,
			allowedHostnames: [],
			development,
			fetchImpl: siteverify(success) as typeof fetch,
		});
	const body = { email: "r@example.com", captchaToken: "XXXX.DUMMY.TOKEN.XXXX" };
	assertEquals(
		(await NewsletterBackendService.subscribe(body, live({ captcha: gate(true, false) }).deps))
			.status,
		400,
	);
	assert(
		(await NewsletterBackendService.subscribe(body, live({ captcha: gate(true, true) }).deps)).ok,
	);
	assertEquals(
		(await NewsletterBackendService.subscribe(body, live({ captcha: gate(false, true) }).deps))
			.status,
		400,
	);
});

Deno.test("live path: a database error is a retryable 503, never a false success", async () => {
	const rpc: NewsletterSubscribeRpc = () =>
		Promise.resolve({ data: null, error: { code: "PGRST106", message: "schema not exposed" } });
	const result = await NewsletterBackendService.subscribe(
		{ email: "r@example.com" },
		live({ rpc }).deps,
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
		live({ rpc }).deps,
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
			live({ rpc: reached }).deps,
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
			live({ rpc }).deps,
		);
		assertEquals(result.status, 422, `${code} is malformed input, not an outage`);
		assert(result.errors?.email);
	}
});

Deno.test("live path: a drifted writer answer is refused (502), and nothing is mailed", async () => {
	const { writer } = live();
	const rpc: NewsletterSubscribeRpc = () =>
		Promise.resolve({ data: { email: "r@example.com", outcome: "added" }, error: null });
	const result = await NewsletterBackendService.subscribe(
		{ email: "r@example.com" },
		live({ rpc, mailer: writer.mailer }).deps,
	);
	assertEquals(result.status, 502);
	assertEquals(writer.mails, []);
});

Deno.test("an unknown topic is a 422 on the topic field, before any write", async () => {
	const { writer, deps } = live();
	const result = await NewsletterBackendService.subscribe(
		{ email: "r@example.com", topic: "weekly" },
		deps,
	);
	assertEquals(result.status, 422);
	assert(result.errors?.topic);
	assertEquals(writer.calls.length, 0);
});

Deno.test("an address over 254 characters is a 422 on the email field, before any write", async () => {
	const { writer, deps } = live();
	const result = await NewsletterBackendService.subscribe(
		{ email: `${"a".repeat(6400)}@example.com` },
		deps,
	);
	assertEquals(result.status, 422);
	assert(result.errors?.email);
	assertEquals(writer.calls.length, 0);
});

Deno.test("the per-address limit refuses the sixth attempt in the window with a retry time", async () => {
	const { deps } = live();
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
// #endregion

// #region The link
Deno.test("linkView maps the read, and an unknown or malformed token is a 404", async () => {
	const read = door({
		subscribed: false,
		unsubscribed: false,
		topics: ["general"],
		pending_topics: ["general"],
		expired: false,
	});
	const view = await NewsletterBackendService.linkView(TOKEN.toUpperCase(), {
		live: true,
		rpc: read.rpc,
	});
	assertEquals(view.data, {
		subscribed: false,
		unsubscribed: false,
		topics: ["general"],
		pendingTopics: ["general"],
		expired: false,
	});
	assertEquals(read.calls, [{ p_token: TOKEN }]);

	assertEquals(
		(await NewsletterBackendService.linkView(TOKEN, { live: true, rpc: door(null).rpc })).status,
		404,
	);
	const never = door(null);
	assertEquals(
		(await NewsletterBackendService.linkView("not-a-token", { live: true, rpc: never.rpc })).status,
		404,
	);
	assertEquals(never.calls, []);
	assertEquals((await NewsletterBackendService.linkView(TOKEN, { live: false })).status, 404);
});

Deno.test("confirm: confirmed and already_confirmed are the same success; expired is a 410", async () => {
	const deps = (outcome: string) => ({
		live: true,
		rpc: door({ outcome, topics: ["general"] }).rpc,
		limiter: new SlidingWindowLimiter(NEWSLETTER_CONFIRM_RULE),
	});
	const confirmed = await NewsletterBackendService.confirm(TOKEN, "c1", deps("confirmed"));
	const again = await NewsletterBackendService.confirm(TOKEN, "c1", deps("already_confirmed"));
	assertEquals([confirmed.status, again.status], [200, 200]);
	assertEquals(confirmed.message, again.message);

	const expired = await NewsletterBackendService.confirm(TOKEN, "c1", deps("expired"));
	assertEquals(expired.status, 410);
	assertEquals(expired.message, NEWSLETTER_LINK_EXPIRED_MESSAGE);
	assertEquals(
		(await NewsletterBackendService.confirm(TOKEN, "c1", deps("unsubscribed"))).status,
		409,
	);
	assertEquals(
		(await NewsletterBackendService.confirm(TOKEN, "c1", deps("not_found"))).status,
		404,
	);
	assertEquals((await NewsletterBackendService.confirm(TOKEN, "c1", deps("spent"))).status, 502);
});

Deno.test("confirm is throttled per client, before the door", async () => {
	const confirm = door({ outcome: "confirmed", topics: ["general"] });
	const deps = {
		live: true,
		rpc: confirm.rpc,
		limiter: new SlidingWindowLimiter(NEWSLETTER_CONFIRM_RULE),
	};
	for (let i = 0; i < NEWSLETTER_CONFIRM_RULE.max; i++) {
		assert((await NewsletterBackendService.confirm(TOKEN, "busy", deps)).ok);
	}
	const refused = await NewsletterBackendService.confirm(TOKEN, "busy", deps);
	assertEquals(refused.status, 429);
	assertEquals(confirm.calls.length, NEWSLETTER_CONFIRM_RULE.max);
	assert(
		(await NewsletterBackendService.confirm(TOKEN, "calm", deps)).ok,
		"another client is unaffected",
	);
});

Deno.test("unsubscribe sends the token and the reason; an unknown reason or token is a 404", async () => {
	const unsub = door({ outcome: "unsubscribed" });
	const result = await NewsletterBackendService.unsubscribe(TOKEN, "one_click", {
		live: true,
		rpc: unsub.rpc,
	});
	assert(result.ok);
	assertEquals(result.data, { outcome: "unsubscribed" });
	assertEquals(unsub.calls, [{ p_token: TOKEN, p_reason: "one_click" }]);

	const never = door({ outcome: "unsubscribed" });
	assertEquals(
		(await NewsletterBackendService.unsubscribe(TOKEN, "because", { live: true, rpc: never.rpc }))
			.status,
		404,
	);
	assertEquals(never.calls, []);
	assertEquals(
		(await NewsletterBackendService.unsubscribe(TOKEN, "link", {
			live: true,
			rpc: door({ outcome: "not_found" }).rpc,
		}))
			.status,
		404,
	);
	assertEquals(
		(await NewsletterBackendService.unsubscribe(TOKEN, "link", {
			live: true,
			rpc: door({ outcome: "already_unsubscribed" }).rpc,
		}))
			.status,
		200,
	);
});
// #endregion
