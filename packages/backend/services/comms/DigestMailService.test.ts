import { assert, assertEquals } from "@std/assert";
import type { MailMessage, MailTransport } from "../mail/transport.ts";
import { ClaimedDigestRowSchema } from "@projective/types/comms";
import {
	buildDigestEmail,
	type DigestDb,
	type DigestDeps,
	DigestMailService,
} from "./DigestMailService.ts";

/** The digest mail (PROJECTS NO2): titles, absolute links and counts, never a body; one pass, recorded. */

// #region Fixtures
const APP = "https://staging.projective.test";
const USER = "0b8e6c4a-2d1f-4e3b-8a7c-9d0e1f2a3b4c";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

function leased(n: number, overrides: Record<string, unknown> = {}) {
	return {
		digest_id: id(n),
		user_id: USER,
		period: "daily",
		window_start: "2026-11-24T08:00:00+00:00",
		window_end: "2026-11-25T08:00:00+00:00",
		status: "pending",
		reason: null,
		attempts: 1,
		address: `person${n}@example.test`,
		total: 3,
		counts: { messages: 1, work: 2 },
		items: [
			{ title: "Stage 2 was funded", action_url: "/projects/prj-abc123", category: "work" },
			{ title: "New application", action_url: null, category: "work" },
			{ title: "Ana replied", action_url: "//evil.test/x", category: "messages" },
		],
		marketing: false,
		...overrides,
	};
}

/** A fixture as the service parses it. */
const row = (raw: unknown) => ClaimedDigestRowSchema.parse(raw);

const closed = (n: number, status: "skipped" | "failed", reason: string) =>
	leased(n, {
		status,
		reason,
		address: null,
		total: null,
		counts: null,
		items: null,
		marketing: null,
	});

interface FakeDb extends DigestDb {
	limits: number[];
	recorded: [string, boolean, string | null, string | null][];
}

function fakeDb(rows: unknown[]): FakeDb {
	const db: FakeDb = {
		limits: [],
		recorded: [],
		claim(limit) {
			db.limits.push(limit);
			return Promise.resolve(rows);
		},
		record(digestId, sent, providerRef, error) {
			db.recorded.push([digestId, sent, providerRef, error]);
			return Promise.resolve();
		},
	};
	return db;
}

function mailbox(
	fail: (m: MailMessage) => boolean = () => false,
): MailTransport & { sent: MailMessage[] } {
	const sent: MailMessage[] = [];
	return {
		sent,
		send(message) {
			if (fail(message)) return Promise.reject(new Error("Resend answered 500"));
			sent.push(message);
			return Promise.resolve({ id: `re_${sent.length}` });
		},
	};
}

function deps(db: DigestDb, mail: MailTransport | null, token: string | null = "tok"): DigestDeps {
	return {
		live: true,
		db,
		mail: () => mail,
		appUrl: APP,
		signUnsubscribe: () => Promise.resolve(token),
	};
}
// #endregion

Deno.test("buildDigestEmail — counts in catalog order, each title with an absolute same-origin link, no body", () => {
	const mail = buildDigestEmail(row(leased(1)), "person1@example.test", APP, null);
	assertEquals(mail.to, "person1@example.test");
	assertEquals(mail.subject, "Your daily digest: 3 updates on Projective");
	assertEquals(mail.idempotencyKey, id(1));
	assertEquals(mail.headers, undefined);
	const lines = mail.text.split("\n");
	assertEquals(lines.slice(0, 5), [
		"Your daily Projective digest: 3 updates.",
		"",
		"Work: 2",
		"Messages: 1",
		"",
	]);
	assert(mail.text.includes(`- Stage 2 was funded\n  ${APP}/projects/prj-abc123`));
	// No link of its own, or one that would leave the app, opens the inbox instead.
	assert(mail.text.includes(`- New application\n  ${APP}/notifications`));
	assert(mail.text.includes(`- Ana replied\n  ${APP}/notifications`));
	assert(!mail.text.includes("evil.test"));
	assert(mail.text.includes(`Choose which emails you get: ${APP}/settings/notifications`));
	assert(!mail.text.includes("Unsubscribe"));
});

Deno.test("buildDigestEmail — more notices than listed are counted; Marketing carries the one-click pair", () => {
	const mail = buildDigestEmail(
		row(leased(2, { total: 60, counts: { work: 58, marketing: 2 } })),
		"person2@example.test",
		APP,
		`${APP}/api/comms/unsubscribe?t=x`,
	);
	assert(mail.text.includes("…and 57 more in your inbox."));
	assert(mail.text.includes("News from Projective: 2"));
	assertEquals(mail.headers, {
		"List-Unsubscribe": `<${APP}/api/comms/unsubscribe?t=x>`,
		"List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
	});
	assertEquals(
		buildDigestEmail(row(leased(3, { total: 1 })), "a@b.test", APP, null).subject,
		"Your daily digest: 1 update on Projective",
	);
});

Deno.test("DigestMailService.send — mails each leased digest once and records sent with Resend's id", async () => {
	const db = fakeDb([leased(1), leased(2, { period: "weekly" })]);
	const mail = mailbox();
	const result = await DigestMailService.send(50, deps(db, mail));
	assert(result.ok);
	assertEquals(result.data, { claimed: 2, sent: 2, failed: 0, skipped: 0, suppressed: 0 });
	assertEquals(db.limits, [50]);
	assertEquals(mail.sent.map((m) => m.to).sort(), ["person1@example.test", "person2@example.test"]);
	assertEquals(
		db.recorded.sort(),
		[[id(1), true, "re_1", null], [id(2), true, "re_2", null]].sort(),
	);
});

Deno.test("DigestMailService.send — closed digests are counted, not mailed; a send that throws is recorded failed", async () => {
	const db = fakeDb([
		closed(1, "skipped", "suppressed_destination"),
		closed(2, "skipped", "no_items"),
		closed(3, "failed", "lease_lapsed"),
		leased(4),
		{ digest_id: id(5), status: "pending" },
	]);
	const mail = mailbox((m) => m.to === "person4@example.test");
	const result = await DigestMailService.send(50, deps(db, mail));
	assert(result.ok);
	assertEquals(result.data, { claimed: 5, sent: 0, failed: 3, skipped: 1, suppressed: 1 });
	assertEquals(mail.sent.length, 0);
	assertEquals(db.recorded.sort(), [
		[id(4), false, null, "Resend answered 500"],
		[id(5), false, null, "unreadable_claim"],
	]);
});

Deno.test("DigestMailService.send — a Marketing digest without an unsubscribe link is not sent", async () => {
	const db = fakeDb([leased(1, { marketing: true })]);
	const mail = mailbox();
	const result = await DigestMailService.send(50, deps(db, mail, null));
	assert(result.ok);
	assertEquals(result.data?.failed, 1);
	assertEquals(mail.sent.length, 0);
	assertEquals(db.recorded, [[id(1), false, null, "no_unsubscribe_link"]]);

	const signed = fakeDb([leased(2, { marketing: true })]);
	const ok = mailbox();
	await DigestMailService.send(50, deps(signed, ok, "tok"));
	assertEquals(ok.sent[0].headers?.["List-Unsubscribe-Post"], "List-Unsubscribe=One-Click");
});

Deno.test("DigestMailService.send — no transport claims nothing; offline is a 503; the batch is bounded", async () => {
	const idle = fakeDb([leased(1)]);
	const none = await DigestMailService.send(50, deps(idle, null));
	assert(none.ok);
	assertEquals(none.data?.claimed, 0);
	assertEquals(idle.limits, []);

	const offline = await DigestMailService.send(50, { ...deps(fakeDb([]), mailbox()), live: false });
	assert(!offline.ok);
	assertEquals(offline.status, 503);

	const db = fakeDb([]);
	await DigestMailService.send(99999, deps(db, mailbox()));
	await DigestMailService.send(0, deps(db, mailbox()));
	assertEquals(db.limits, [500, 50]);
});
