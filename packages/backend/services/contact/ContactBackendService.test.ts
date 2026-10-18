/**
 * ContactBackendService (Decision #276) through its seams: the stub and production refusal, the
 * honeypot, the session-bound parts (attachments, engagements), the rate limits, and the live path's
 * argument shape and refusal mapping — no database, no network.
 */
import { assert, assertEquals, assertFalse, assertMatch } from "@std/assert";
import type { ContactEngagementOption } from "@projective/types/contact";
import type { ProjectSummary } from "@projective/types/projects";
import { SlidingWindowLimiter } from "../../core/rate-limit.ts";
import type { ReadActor } from "../read-actor.ts";
import type { SubmitRpcArgs } from "./contact-rpc.ts";
import {
	ContactBackendService,
	type ContactDeps,
	engagementOption,
} from "./ContactBackendService.ts";

const GUEST: ReadActor = { userId: "", contextId: "", contextType: "personal" } as ReadActor;
const ADA: ReadActor = {
	userId: "00000000-0000-4000-8000-00000000ada0",
	contextId: "",
	contextType: "personal",
	accessToken: "token",
} as ReadActor;
const LAPSED: ReadActor = { ...ADA, accessToken: undefined } as ReadActor;
const META = { clientKey: "203.0.113.7" };
const MESSAGE = "Our payout has not arrived seven days after approval.";
const SUPPORT = {
	intent: "support",
	name: "Ada",
	email: "ada@example.com",
	topic: "payments",
	message: MESSAGE,
};

const ENGAGEMENTS: ContactEngagementOption[] = [
	{
		slug: "prj-brand",
		title: "Brand refresh",
		format: "pipeline",
		status: "active",
		counterparty: "Northwind",
	},
	{
		slug: "prj-coach",
		title: "Weekly coaching",
		format: "session",
		status: "on_hold",
		counterparty: null,
	},
];

/** Fresh limiters per test, so one test's traffic never throttles the next. */
function deps(extra: ContactDeps = {}): ContactDeps {
	return {
		live: false,
		production: false,
		engagements: () => Promise.resolve(ENGAGEMENTS),
		limiters: {
			ip: new SlidingWindowLimiter({ max: 100, windowMs: 60_000 }),
			email: new SlidingWindowLimiter({ max: 100, windowMs: 60_000 }),
			attachments: new SlidingWindowLimiter({ max: 100, windowMs: 60_000 }),
		},
		...extra,
	};
}

Deno.test("stub (development): a valid request answers a 201 receipt and stores nothing", async () => {
	const res = await ContactBackendService.submit(SUPPORT, GUEST, META, deps());
	assert(res.ok);
	assertEquals(res.status, 201);
	assertMatch(res.data!.reference, /^CT-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/);
	assertEquals(res.data!.intent, "support");
	assertEquals(res.data!.status, "backlog");
});

Deno.test("stub (production): refuses with 503 rather than acknowledge an unread request", async () => {
	const res = await ContactBackendService.submit(SUPPORT, GUEST, META, deps({ production: true }));
	assertFalse(res.ok);
	assertEquals(res.status, 503);
	assertEquals(
		(await ContactBackendService.initAttachment(
			{ name: "a.png", mimeType: "image/png", sizeBytes: 9 },
			ADA,
			deps({ production: true }),
		)).status,
		503,
	);
});

Deno.test("a malformed request is a 422 keyed by field", async () => {
	const res = await ContactBackendService.submit(
		{ ...SUPPORT, email: "nope", message: "short" },
		GUEST,
		META,
		deps(),
	);
	assertEquals(res.status, 422);
	assert(res.errors?.email);
	assert(res.errors?.message);
});

Deno.test("the honeypot answers a receipt like any other and never reaches the writer", async () => {
	let called = false;
	const res = await ContactBackendService.submit(
		{ ...SUPPORT, website: "https://spam.example" },
		GUEST,
		META,
		deps({ live: true, rpc: () => (called = true, Promise.resolve({ data: null, error: null })) }),
	);
	assert(res.ok);
	assertEquals(res.status, 201);
	assertFalse(called);
});

Deno.test("attachments and engagements need a session; a lapsed one is told to sign in again", async () => {
	const withFile = { ...SUPPORT, attachmentIds: ["00000000-0000-4000-8000-0000000000a1"] };
	assertEquals((await ContactBackendService.submit(withFile, GUEST, META, deps())).status, 401);
	const dispute = {
		intent: "dispute",
		name: "Ada",
		email: "ada@example.com",
		engagementSlug: "prj-brand",
		message: MESSAGE,
	};
	assertEquals((await ContactBackendService.submit(dispute, GUEST, META, deps())).status, 401);
	assertEquals((await ContactBackendService.submit(SUPPORT, LAPSED, META, deps())).status, 401);
	assertEquals(
		(await ContactBackendService.initAttachment(
			{ name: "a.png", mimeType: "image/png", sizeBytes: 9 },
			GUEST,
			deps(),
		)).status,
		401,
	);
});

Deno.test("a dispute's engagement is resolved against the caller's own — and stored as resolved", async () => {
	const seen: SubmitRpcArgs[] = [];
	const live = deps({
		live: true,
		rpc: (args) => {
			seen.push(args);
			return Promise.resolve({
				data: {
					id: "00000000-0000-4000-8000-000000000001",
					reference: "CT-7K4Q-2M9X",
					intent: "dispute",
					status: "backlog",
					created_at: "2026-10-17T20:00:00Z",
				},
				error: null,
			});
		},
	});
	const base = { intent: "dispute", name: "Ada", email: "ada@example.com", message: MESSAGE };
	const refused = await ContactBackendService.submit(
		{ ...base, engagementSlug: "prj-someone-elses" },
		ADA,
		META,
		live,
	);
	assertEquals(refused.status, 422);
	assert(refused.errors?.engagementSlug);
	assertEquals(seen.length, 0);

	const ok = await ContactBackendService.submit(
		{ ...base, engagementSlug: "prj-brand" },
		ADA,
		META,
		live,
	);
	assert(ok.ok);
	assertEquals(ok.data!.reference, "CT-7K4Q-2M9X");
	assertEquals(seen[0].p_payload.engagement, {
		slug: "prj-brand",
		title: "Brand refresh",
		format: "pipeline",
	});
	assertEquals(seen[0].p_email, "ada@example.com");
});

Deno.test("live: a writer refusal reaches the form; a drifted answer is a 502", async () => {
	const refuse = deps({
		live: true,
		rpc: () =>
			Promise.resolve({ data: null, error: { code: "PR429", message: "contact: this address…" } }),
	});
	assertEquals((await ContactBackendService.submit(SUPPORT, GUEST, META, refuse)).status, 429);
	const drift = deps({
		live: true,
		rpc: () => Promise.resolve({ data: { ok: true }, error: null }),
	});
	assertEquals((await ContactBackendService.submit(SUPPORT, GUEST, META, drift)).status, 502);
});

Deno.test("rate limits: per caller address, then per reply address, with a retryAt", async () => {
	const tight = deps({
		limiters: {
			ip: new SlidingWindowLimiter({ max: 1, windowMs: 60_000 }),
			email: new SlidingWindowLimiter({ max: 100, windowMs: 60_000 }),
		},
	});
	assert((await ContactBackendService.submit(SUPPORT, GUEST, META, tight)).ok);
	const limited = await ContactBackendService.submit(SUPPORT, GUEST, META, tight);
	assertEquals(limited.status, 429);
	assert(typeof limited.details?.retryAt === "string");

	const perEmail = deps({
		limiters: {
			ip: new SlidingWindowLimiter({ max: 100, windowMs: 60_000 }),
			email: new SlidingWindowLimiter({ max: 1, windowMs: 60_000 }),
		},
	});
	assert((await ContactBackendService.submit(SUPPORT, GUEST, META, perEmail)).ok);
	assertEquals(
		(await ContactBackendService.submit({ ...SUPPORT, email: "ADA@example.com" }, GUEST, {
			clientKey: "other",
		}, perEmail)).status,
		429,
	);
});

Deno.test("stub attachments: declared, checked, then sendable once by their owner", async () => {
	ContactBackendService.resetStub();
	const d = deps();
	const ticket = await ContactBackendService.initAttachment(
		{ name: "screen.png", mimeType: "image/png", sizeBytes: 2048 },
		ADA,
		d,
	);
	assert(ticket.ok);
	assertEquals(ticket.data!.signedUrl, null, "the stub has no storage to send to");
	const id = ticket.data!.attachmentId;

	const early = await ContactBackendService.submit(
		{ ...SUPPORT, attachmentIds: [id] },
		ADA,
		META,
		d,
	);
	assertEquals(early.status, 422, "an attachment that has not finished its check cannot be sent");

	const done = await ContactBackendService.completeAttachment(id, ADA, d);
	assert(done.ok);
	assertEquals(done.data!.name, "screen.png");
	assertEquals(
		(await ContactBackendService.completeAttachment(
			id,
			{ ...ADA, userId: "someone-else" } as ReadActor,
			d,
		)).status,
		404,
	);

	const sent = await ContactBackendService.submit(
		{ ...SUPPORT, attachmentIds: [id] },
		ADA,
		META,
		d,
	);
	assert(sent.ok);
	const again = await ContactBackendService.submit(
		{ ...SUPPORT, attachmentIds: [id] },
		ADA,
		META,
		d,
	);
	assertEquals(again.status, 422, "an attachment is sent with one request only");

	const refused = await ContactBackendService.initAttachment(
		{ name: "tool.exe", mimeType: "application/x-msdownload", sizeBytes: 10 },
		ADA,
		d,
	);
	assertEquals(refused.status, 422);
});

Deno.test("disputeEngagements: none for a guest; a failing feed is an empty list, not an error", async () => {
	assertEquals(await ContactBackendService.disputeEngagements(GUEST, deps()), []);
	assertEquals(
		await ContactBackendService.disputeEngagements(
			ADA,
			deps({ engagements: () => Promise.reject(new Error("down")) }),
		),
		[],
	);
	assertEquals((await ContactBackendService.disputeEngagements(ADA, deps())).length, 2);
});

Deno.test("engagementOption: personal and closed engagements are not disputable", () => {
	const row = {
		slug: "prj-x",
		title: "X",
		format: "one_off",
		status: "active",
		personal: false,
		counterparty: { name: "Jane", avatar: null, handle: null },
	} as unknown as ProjectSummary;
	assertEquals(engagementOption(row), {
		slug: "prj-x",
		title: "X",
		format: "one_off",
		status: "active",
		counterparty: "Jane",
	});
	assertEquals(engagementOption({ ...row, personal: true } as ProjectSummary), null);
	assertEquals(engagementOption({ ...row, status: "completed" } as ProjectSummary), null);
	assertEquals(
		engagementOption({ ...row, counterparty: null } as ProjectSummary)?.counterparty,
		null,
	);
});
