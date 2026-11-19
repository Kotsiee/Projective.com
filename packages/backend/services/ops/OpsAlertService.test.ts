import { assertEquals, assertStringIncludes } from "@std/assert";
import { AlertsReadSchema } from "@projective/types/ops";
import {
	type AlertDb,
	type AlertDeps,
	alertNotice,
	alertText,
	deliverAlerts,
	digestMessage,
	failureCode,
	safeSample,
	toAlertClaim,
	toAlertsRead,
	webhookPort,
} from "./OpsAlertService.ts";
import type { MailMessage } from "../mail/transport.ts";

/*
 * The alert sweep (MR4, Decision #461). The database groups, dedupes and raises the dead-man switch
 * (proven by supabase/probes/ops_alerts.sql); these tests prove what the service does with what it
 * claims: one webhook post per alert, one email digest per sweep, every outcome recorded, a failure
 * left pending with its status, an unconfigured channel waiting, and nothing personal in any payload.
 */

// #region Fakes
const DRIFT = {
	scope: "finance.reconcile_wallets",
	fingerprint: "2f6a0b0e",
	level: "error",
	count: 1,
	first_seen: "2026-11-18T03:40:00.000+00:00",
	last_seen: "2026-11-18T03:40:00.000+00:00",
	attempts: 0,
	sample: { wallet_id: "2f6a0b0e", currency: "USD", balance_cents: 1700, ledger_sum_cents: 1000 },
};

function claimOf(...rows: Array<Record<string, unknown>>) {
	return { folded: 0, opened: rows.length, silent: 0, deliveries: rows };
}

function row(
	id: string,
	channel: "webhook" | "email" | "in_app",
	extra: Record<string, unknown> = {},
) {
	return { ...DRIFT, id, channel, ...extra };
}

const W1 = "11111111-1111-4111-8111-111111111111";
const E1 = "22222222-2222-4222-8222-222222222222";
const E2 = "33333333-3333-4333-8333-333333333333";
const I1 = "44444444-4444-4444-8444-444444444444";

interface Harness {
	deps: AlertDeps;
	posts: string[];
	mails: MailMessage[];
	records: Array<{ id: string; ok: boolean; error: string | null }>;
	notices: Array<{ id: string; title: string; body: string }>;
}

function harness(
	claim: unknown,
	opts: {
		webhookFails?: string;
		mailFails?: boolean;
		noWebhook?: boolean;
		noMail?: boolean;
		inAppFails?: boolean;
		noOperators?: boolean;
	} = {},
): Harness {
	const posts: string[] = [];
	const mails: MailMessage[] = [];
	const records: Harness["records"] = [];
	const notices: Harness["notices"] = [];
	const db: AlertDb = {
		claim: () => Promise.resolve(claim),
		record: (id, ok, error) => {
			records.push({ id, ok, error });
			return Promise.resolve();
		},
		deliverInApp: (id, title, body) => {
			if (opts.inAppFails) {
				return Promise.reject(new Error("ops.fn_deliver_alert_in_app failed (08006)"));
			}
			notices.push({ id, title, body });
			return Promise.resolve({ sent: !opts.noOperators });
		},
	};
	return {
		posts,
		mails,
		records,
		notices,
		deps: {
			live: true,
			db,
			webhook: opts.noWebhook ? null : {
				post: ({ text }) => {
					posts.push(text);
					return opts.webhookFails
						? Promise.reject(new Error(opts.webhookFails))
						: Promise.resolve();
				},
			},
			mail: opts.noMail ? null : {
				to: "ops@example.test",
				transport: {
					send: (message) => {
						mails.push(message);
						return opts.mailFails
							? Promise.reject(new Error("Resend answered 500"))
							: Promise.resolve();
					},
				},
			},
			appUrl: "https://app.example.test",
		},
	};
}
// #endregion

Deno.test("a drift alert is posted to the webhook and mailed in the digest, each recorded sent", async () => {
	const h = harness(claimOf(row(W1, "webhook"), row(E1, "email")));
	const res = await deliverAlerts(50, h.deps);
	assertEquals(res.ok, true);
	assertEquals(res.data, { folded: 0, opened: 2, silent: 0, claimed: 2, sent: 2, failed: 0 });
	assertEquals(h.posts.length, 1);
	assertStringIncludes(h.posts[0], "finance.reconcile_wallets · error · 1 row");
	assertStringIncludes(h.posts[0], "Group 2f6a0b0e");
	assertStringIncludes(h.posts[0], "balance_cents 1,700");
	assertStringIncludes(h.posts[0], "https://app.example.test/admin/ledger");
	assertEquals(h.mails.length, 1);
	assertEquals(h.mails[0].to, "ops@example.test");
	assertEquals(h.records, [{ id: W1, ok: true, error: null }, { id: E1, ok: true, error: null }]);
});

Deno.test("one digest carries every email alert of the sweep", async () => {
	const h = harness(
		claimOf(
			row(E1, "email"),
			row(E2, "email", { scope: "ops.scheduler", fingerprint: "finance-billing-cycle:run_failed" }),
		),
	);
	await deliverAlerts(50, h.deps);
	assertEquals(h.mails.length, 1);
	assertEquals(h.mails[0].subject, "Projective alerts: 2 alerts");
	assertStringIncludes(h.mails[0].text, "finance.reconcile_wallets");
	assertStringIncludes(h.mails[0].text, "ops.scheduler");
	assertEquals(h.records.map((r) => r.ok), [true, true]);
});

Deno.test("a failed send is recorded failed with its status, so it stays pending and retries", async () => {
	const h = harness(claimOf(row(W1, "webhook"), row(E1, "email")), {
		webhookFails: "webhook answered 503",
		mailFails: true,
	});
	const res = await deliverAlerts(50, h.deps);
	assertEquals(res.data?.failed, 2);
	assertEquals(h.records, [{ id: W1, ok: false, error: "503" }, {
		id: E1,
		ok: false,
		error: "500",
	}]);
});

Deno.test("a channel nobody configured records not_configured and sends nothing", async () => {
	const h = harness(claimOf(row(W1, "webhook"), row(E1, "email")), {
		noWebhook: true,
		noMail: true,
	});
	await deliverAlerts(50, h.deps);
	assertEquals(h.posts.length + h.mails.length, 0);
	assertEquals(h.records.map((r) => r.error), ["not_configured", "not_configured"]);
});

Deno.test("a missing nightly run reads as a dead-man alert", async () => {
	const h = harness(claimOf(row(W1, "webhook", {
		scope: "finance.conservation",
		fingerprint: "silence",
		sample: { silent_minutes: 27 * 60 },
	})));
	const res = await deliverAlerts(50, h.deps);
	assertEquals(res.data?.sent, 1);
	assertStringIncludes(h.posts[0], "finance.conservation has written nothing for 27 hours");
	assertStringIncludes(h.posts[0], "Dead-man switch");
});

Deno.test("no payload carries an address, a name, a sentence or a bank detail", async () => {
	const h = harness(claimOf(
		row(W1, "webhook", {
			sample: {
				wallet_id: "2f6a0b0e",
				currency: "USD",
				balance_cents: 1700,
				note: "paid to ada.lovelace@example.com",
				owner_name: "Ada Lovelace",
				iban: "GB29NWBK60161331926819",
				nested: { email: "x@y.z" },
				currency_hint: "ada@example.com",
			},
		}),
		row(E1, "email", { sample: { reason: "ada@example.com", job: "finance-billing-cycle" } }),
	));
	await deliverAlerts(50, h.deps);
	const everything = [...h.posts, ...h.mails.map((m) => `${m.subject}\n${m.text}`)].join("\n");
	for (const leak of ["@", "Ada", "Lovelace", "GB29", "IBAN", "paid to"]) {
		assertEquals(everything.includes(leak), false, `payload leaked ${leak}`);
	}
	assertStringIncludes(everything, "balance_cents 1,700");
	assertStringIncludes(everything, "job finance-billing-cycle");
});

Deno.test("no live database is a 503, and a claim that throws is a 503 with nothing sent", async () => {
	const h = harness(claimOf(row(W1, "webhook")));
	assertEquals((await deliverAlerts(50, { ...h.deps, live: false })).status, 503);
	const broken = harness(null);
	broken.deps.db.claim = () => Promise.reject(new Error("ops.fn_claim_alerts failed (08006)"));
	assertEquals((await deliverAlerts(50, broken.deps)).status, 503);
	assertEquals(broken.posts.length, 0);
});

Deno.test("safeSample keeps figures, short ids and vocabulary only", () => {
	assertEquals(
		safeSample({
			balance_cents: 10,
			wallet_id: "2f6a0b0e",
			currency: "USD",
			note: "hello there",
			iban: "GB29NWBK60161331926819",
			ok: true,
		}),
		{ balance_cents: 10, wallet_id: "2f6a0b0e", currency: "USD" },
	);
});

Deno.test("toAlertClaim drops an alert that does not parse and keeps the counts", () => {
	const claim = toAlertClaim({
		folded: 3,
		opened: 1,
		silent: 0,
		deliveries: [row(W1, "webhook"), { id: "nope" }],
	});
	assertEquals(claim.folded, 3);
	assertEquals(claim.deliveries.map((d) => d.id), [W1]);
});

Deno.test("alertText and the digest read as one message each", () => {
	const claim = toAlertClaim(claimOf(row(W1, "webhook", { count: 3 })));
	assertStringIncludes(alertText(claim.deliveries[0], "https://a.test/"), "3 rows");
	assertStringIncludes(
		alertText(claim.deliveries[0], "https://a.test/"),
		"https://a.test/admin/ledger",
	);
	assertEquals(
		digestMessage(claim.deliveries, "https://a.test", "o@e.test").subject,
		"Projective alerts: 1 alert",
	);
});

Deno.test("failureCode keeps a status or a class, never a body", () => {
	assertEquals(failureCode(new Error("webhook answered 429")), "429");
	assertEquals(failureCode(new DOMException("t", "TimeoutError")), "timeout");
	assertEquals(failureCode(new Error("socket hang up")), "error");
});

Deno.test("webhookPort takes https, or a local receiver in development only", () => {
	assertEquals(webhookPort("https://hooks.example.test/x", "production") !== null, true);
	assertEquals(webhookPort("http://hooks.example.test/x", "production"), null);
	assertEquals(webhookPort("http://localhost:9999/hook", "development") !== null, true);
	assertEquals(webhookPort("http://localhost:9999/hook", "production"), null);
	assertEquals(webhookPort("XXXX-XXXX", "development"), null);
	assertEquals(webhookPort(undefined, "development"), null);
});

Deno.test("webhookPort posts Slack-compatible JSON and throws on a refusal", async () => {
	const seen: Array<{ url: string; body: string }> = [];
	const port = webhookPort("https://hooks.example.test/x", "production", (url, init) => {
		seen.push({ url: String(url), body: String(init?.body) });
		return Promise.resolve(new Response("no", { status: seen.length === 1 ? 200 : 503 }));
	})!;
	await port.post({ text: "hello" });
	assertEquals(JSON.parse(seen[0].body), { text: "hello" });
	let threw = "";
	await port.post({ text: "again" }).catch((e) => threw = e.message);
	assertEquals(threw, "webhook answered 503");
});

Deno.test("toAlertsRead maps the operator read and parses", () => {
	const read = toAlertsRead({
		as_of: "2026-11-18T22:00:00+00:00",
		pending: 1,
		rules: [{
			kind: "silence",
			scope: "finance.conservation",
			min_level: null,
			max_silence_minutes: 1560,
			channel: "email",
			dedupe_window_minutes: 1440,
			enabled: true,
		}],
		silence: [{ scope: "finance.conservation", last_row_at: null }],
		deliveries: [{
			id: W1,
			channel: "webhook",
			scope: "finance.reconcile_wallets",
			fingerprint: "2f6a0b0e",
			level: "error",
			count: 2,
			first_seen: "2026-11-18T03:40:00+00:00",
			last_seen: "2026-11-19T03:40:00+00:00",
			status: "pending",
			attempts: 1,
			next_attempt_at: "2026-11-19T03:42:00+00:00",
			sent_at: null,
			last_error: "503",
		}],
	});
	assertEquals(AlertsReadSchema.safeParse(read).success, true);
	assertEquals(read.rules[0].maxSilenceMinutes, 1560);
	assertEquals(read.deliveries[0].lastError, "503");
	assertEquals(toAlertsRead(null).deliveries, []);
});

// #region The in-app channel, and channels failing apart (OPS5)
Deno.test("an in-app alert is one notice through the door, its own record, and no link line", async () => {
	const h = harness(claimOf(row(I1, "in_app", {
		scope: "ops.webhooks",
		fingerprint: "stripe:failing",
		sample: { provider: "stripe", reason: "failing", failures: 6, threshold: 5 },
	})));
	const res = await deliverAlerts(50, h.deps);
	assertEquals(res.data?.sent, 1);
	assertEquals(h.records, [], "the in-app door records its own send");
	assertEquals(h.notices.length, 1);
	assertEquals(h.notices[0].id, I1);
	assertEquals(h.notices[0].title, "ops.webhooks · error · 1 row");
	assertStringIncludes(h.notices[0].body, "Group stripe:failing");
	assertStringIncludes(h.notices[0].body, "provider stripe");
	assertStringIncludes(h.notices[0].body, "failures 6");
	assertEquals(h.notices[0].body.includes("/admin/ledger"), false);
});

Deno.test("no operator to tell counts as failed, and the database has already recorded it", async () => {
	const h = harness(claimOf(row(I1, "in_app")), { noOperators: true });
	const res = await deliverAlerts(50, h.deps);
	assertEquals([res.data?.sent, res.data?.failed], [0, 1]);
	assertEquals(h.records, []);
});

Deno.test("a webhook that is down does not stop the digest or the in-app notice", async () => {
	const h = harness(claimOf(row(W1, "webhook"), row(E1, "email"), row(I1, "in_app")), {
		webhookFails: "webhook answered 502",
	});
	const res = await deliverAlerts(50, h.deps);
	assertEquals([res.data?.sent, res.data?.failed], [2, 1]);
	assertEquals(h.records, [{ id: W1, ok: false, error: "502" }, { id: E1, ok: true, error: null }]);
	assertEquals(h.mails.length, 1);
	assertEquals(h.notices.map((n) => n.id), [I1]);
});

Deno.test("mail that is down, or an in-app door that raises, does not stop the webhook", async () => {
	const h = harness(claimOf(row(W1, "webhook"), row(E1, "email"), row(I1, "in_app")), {
		mailFails: true,
		inAppFails: true,
	});
	const res = await deliverAlerts(50, h.deps);
	assertEquals([res.data?.sent, res.data?.failed], [1, 2]);
	assertEquals(h.posts.length, 1);
	assertEquals(h.records, [
		{ id: W1, ok: true, error: null },
		{ id: E1, ok: false, error: "500" },
		{ id: I1, ok: false, error: "error" },
	]);
});

Deno.test("a stale job and a webhook burst read with their job, provider and reason", () => {
	const claim = toAlertClaim(claimOf(
		row(W1, "webhook", {
			scope: "ops.scheduler",
			fingerprint: "finance-recurring-deposits:stale",
			sample: {
				job: "finance-recurring-deposits",
				reason: "stale",
				cadence_minutes: 60,
				stale_minutes: 200,
			},
		}),
		row(E1, "email", {
			scope: "ops.webhooks",
			fingerprint: "stripe-v2:signature",
			level: "warn",
			sample: { provider: "stripe-v2", reason: "signature", failures: 5 },
		}),
	));
	const stale = alertText(claim.deliveries[0], "https://a.test");
	assertStringIncludes(stale, "job finance-recurring-deposits");
	assertStringIncludes(stale, "reason stale");
	assertStringIncludes(stale, "stale_minutes 200");
	const burst = alertNotice(claim.deliveries[1], "https://a.test");
	assertEquals(burst.title, "ops.webhooks · warn · 1 row");
	assertStringIncludes(burst.body, "provider stripe-v2");
	assertEquals(safeSample({ provider: "Ada Lovelace <a@b.c>" }), {});
});
// #endregion
