import { assertEquals } from "@std/assert";
import type { WebhookFailure, WebhookOutcomeClass } from "@projective/types/ops";
import {
	createWebhookFailureRecorder,
	heartbeat,
	type WebhookFailureDoor,
	webhookOutcomeClass,
} from "./OpsHealthService.ts";

/*
 * OPS5: the webhook failure record and the heartbeat. The database folds each call into one row per
 * provider, class and minute and turns a burst into an alert (supabase/probes/ops_alerts.sql); these
 * tests prove what reaches the door, and how often, and what the heartbeat answers.
 */

// #region Fakes
interface Call {
	provider: string;
	outcome: WebhookOutcomeClass;
	count: number;
	eventId?: string;
}

function fakeDoor(calls: Call[], fails = false): WebhookFailureDoor {
	return (failure, outcome, count) => {
		calls.push({ provider: failure.provider, outcome, count, eventId: failure.eventId });
		return fails
			? Promise.reject(new Error("ops.fn_record_webhook_failure failed (08006)"))
			: Promise.resolve();
	};
}

function clock(start = Date.UTC(2026, 10, 19, 2, 0, 0)) {
	let t = start;
	return { now: () => t, advance: (ms: number) => t += ms };
}

const FORGED: WebhookFailure = { provider: "stripe", status: 400, reason: "signature_invalid" };
// #endregion

Deno.test("an outcome's class: a 5xx is a failure, a signature reason a signature, any other 4xx refused", () => {
	assertEquals(webhookOutcomeClass(500, "handler_failed"), "failure");
	assertEquals(webhookOutcomeClass(503, "not_configured"), "failure");
	assertEquals(webhookOutcomeClass(400, "signature_invalid"), "signature");
	assertEquals(webhookOutcomeClass(400, "signature_missing"), "signature");
	assertEquals(webhookOutcomeClass(400, "not_json"), "refused");
	assertEquals(webhookOutcomeClass(404, "unknown_provider"), "refused");
});

Deno.test("the first ten forged posts of a minute are written one by one, so a threshold of 5 is exact", async () => {
	const calls: Call[] = [];
	const c = clock();
	const rec = createWebhookFailureRecorder(fakeDoor(calls), c.now);
	for (let i = 0; i < 10; i++) await rec.record(FORGED);
	assertEquals(calls.length, 10);
	assertEquals(calls.every((x) => x.count === 1 && x.outcome === "signature"), true);
});

Deno.test("a flood is a handful of calls a minute, and the per-minute counter loses nothing", async () => {
	const calls: Call[] = [];
	const c = clock();
	const rec = createWebhookFailureRecorder(fakeDoor(calls), c.now);
	for (let i = 0; i < 1000; i++) await rec.record(FORGED);
	// 1..10 one by one, then at 16, 32, 64, 128, 256, 512: 16 calls for 1,000 posts.
	assertEquals(calls.length, 16);
	assertEquals(calls.reduce((sum, x) => sum + x.count, 0), 512);
	c.advance(60_000);
	await rec.record(FORGED);
	// The next minute's first write carries the 488 the last power of 2 left behind.
	assertEquals(calls.at(-1)?.count, 489);
	assertEquals(calls.reduce((sum, x) => sum + x.count, 0), 1001);
});

Deno.test("each provider and class has its own counter", async () => {
	const calls: Call[] = [];
	const c = clock();
	const rec = createWebhookFailureRecorder(fakeDoor(calls), c.now);
	for (const provider of ["stripe", "stripe-v2", "zoom", "outlook", "unknown"]) {
		await rec.record({ provider, status: 400, reason: "signature_invalid" });
		await rec.record({ provider, status: 500, reason: "handler_failed", eventId: "evt_1" });
	}
	assertEquals(calls.length, 10);
	assertEquals(
		calls.map((x) => `${x.provider}:${x.outcome}:${x.count}`),
		[
			"stripe:signature:1",
			"stripe:failure:1",
			"stripe-v2:signature:1",
			"stripe-v2:failure:1",
			"zoom:signature:1",
			"zoom:failure:1",
			"outlook:signature:1",
			"outlook:failure:1",
			"unknown:signature:1",
			"unknown:failure:1",
		],
	);
	assertEquals(calls[1].eventId, "evt_1");
});

Deno.test("a failure that is not facts only is dropped, and a door that fails never throws", async () => {
	const calls: Call[] = [];
	const rec = createWebhookFailureRecorder(fakeDoor(calls, true));
	await rec.record({
		provider: "Stripe Inc <ops@example.com>",
		status: 400,
		reason: "signature_invalid",
	});
	await rec.record({ provider: "stripe", status: 200, reason: "fine" });
	assertEquals(calls.length, 0);
	await rec.record(FORGED);
	assertEquals(calls.length, 1, "the failing door was called, and its error stayed inside");
});

Deno.test("the heartbeat is ok only when the database answers, the watcher ran and no alert waited", async () => {
	const read = (value: unknown) => () => Promise.resolve(value);
	assertEquals(await heartbeat({ live: true, read: read({ watch: true, alerts: true }) }), {
		ok: true,
	});
	assertEquals(await heartbeat({ live: true, read: read({ watch: false, alerts: true }) }), {
		ok: false,
	});
	assertEquals(await heartbeat({ live: true, read: read({ watch: true, alerts: false }) }), {
		ok: false,
	});
	assertEquals(
		await heartbeat({
			live: true,
			read: () => Promise.reject(new Error("ops.fn_heartbeat failed (08006)")),
		}),
		{ ok: false },
		"a database that does not answer",
	);
	assertEquals(await heartbeat({ live: true, read: read(null) }), { ok: false });
	assertEquals(await heartbeat({ live: false, read: read({ watch: true, alerts: true }) }), {
		ok: false,
	});
});
