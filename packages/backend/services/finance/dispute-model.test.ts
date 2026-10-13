import { assertEquals } from "@std/assert";
import { DisputeCaseSchema, DisputeQueueSchema } from "@projective/types/finance";
import {
	type RawDispute,
	type RawQueueItem,
	toDisputeCase,
	toDisputeQueue,
} from "./dispute-model.ts";

/*
 * finance.get_dispute → DisputeCase (Decision #212). A wrong mapping here would show a reader the wrong
 * side of a case, money in the wrong currency, or offer an action the database will refuse.
 */

// #region Fixtures
const ID = "11111111-1111-4111-8111-111111111111";
const FILE = "22222222-2222-4222-8222-222222222222";

function raw(over: Partial<RawDispute> = {}): RawDispute {
	return {
		id: ID,
		kind: "no_show",
		status: "resolved_split",
		role: "claimant",
		reason: "The provider did not join the session.",
		opened_at: "2026-10-13T10:00:00.000Z",
		respond_by: null,
		responded_at: "2026-10-13T11:00:00.000Z",
		escalated_at: "2026-10-13T11:00:00.000Z",
		resolved_at: "2026-10-13T12:00:00.000Z",
		resolution_notes: "Both accounts are credible.",
		resolved_by_operator: true,
		payee_share_bp: 2500,
		settlement: { payee_minor: 2375, fee_minor: 125, refund_minor: 7500, currency: "GBP" },
		audit: {
			verdict: "ambiguous",
			presence_outcome: "untracked",
			tracked: false,
			host_presence_pct: 0,
			claimant_presence_pct: 140,
			threshold_pct: 80,
			audited_at: "2026-10-13T10:30:00.000Z",
		},
		amount_minor: 10000,
		currency: "GBP",
		project: { id: ID, slug: "prj-abcdefghjk" },
		sitting: {
			id: ID,
			slug: "ssn-abcdefghjk",
			title: "Kick-off",
			starts_at: "2026-10-13T08:00:00.000Z",
			ends_at: "2026-10-13T09:00:00.000Z",
		},
		messages: [
			{
				id: ID,
				party: "respondent",
				body: "I was there.",
				created_at: "2026-10-13T11:00:00.000Z",
				mine: false,
				files: [{ id: FILE, name: "shot.png", mime_type: "image/png", size_bytes: 10 }],
			},
			{
				id: FILE,
				party: "stranger",
				body: "?",
				created_at: "2026-10-13T11:00:00.000Z",
				mine: false,
				files: null,
			},
		],
		can_respond: false,
		can_escalate: false,
		can_resolve: false,
		...over,
	};
}
// #endregion

Deno.test("a ruling maps with its settlement, labels and the reader's side", () => {
	const d = toDisputeCase(raw());
	if (!d) throw new Error("expected a case");
	assertEquals(DisputeCaseSchema.safeParse(d).success, true);
	assertEquals(d.status, "resolved_split");
	assertEquals(d.role, "claimant");
	assertEquals(d.payeeShareBp, 2500);
	assertEquals(d.settlement?.payeeMinor, 2375);
	assertEquals(d.settlement?.refundMinor, 7500);
	assertEquals(d.settlement?.deferred, false);
	assertEquals(typeof d.settlement?.payeeLabel, "string");
	assertEquals(d.amountLabel.includes("100"), true);
	assertEquals(d.projectSlug, "prj-abcdefghjk");
});

Deno.test("the audit is clamped and a statement from an unknown party is dropped", () => {
	const d = toDisputeCase(raw())!;
	assertEquals(d.audit?.claimantPresencePct, 100);
	assertEquals(d.audit?.verdict, "ambiguous");
	assertEquals(d.messages.length, 1);
	assertEquals(d.messages[0].files[0], {
		id: FILE,
		name: "shot.png",
		mimeType: "image/png",
		sizeBytes: 10,
	});
});

Deno.test("a deferred or by-fact settlement keeps its flags", () => {
	const deferred = toDisputeCase(raw({
		status: "resolved_release",
		payee_share_bp: null,
		settlement: { deferred: true, payee_minor: 0, fee_minor: 0, refund_minor: 0, currency: "GBP" },
	}))!;
	assertEquals(deferred.settlement?.deferred, true);
	const byFact = toDisputeCase(raw({
		status: "resolved_refund",
		payee_share_bp: null,
		settlement: { by_fact: true, escrow_status: "refunded", currency: "GBP" },
	}))!;
	assertEquals(byFact.settlement?.byFact, true);
	assertEquals(byFact.settlement?.refundMinor, 0);
});

Deno.test("an unknown status or role, or no row, is not a case", () => {
	assertEquals(toDisputeCase(null), null);
	assertEquals(toDisputeCase(raw({ status: "resolved" })), null);
	assertEquals(toDisputeCase(raw({ role: "stranger" })), null);
});

Deno.test("a live case carries the actions the database offers", () => {
	const d = toDisputeCase(raw({
		status: "awaiting_response",
		role: "respondent",
		respond_by: "2026-10-15T10:00:00.000Z",
		resolved_at: null,
		resolution_notes: null,
		resolved_by_operator: false,
		payee_share_bp: null,
		settlement: null,
		can_respond: true,
		can_escalate: true,
	}))!;
	assertEquals(d.settlement, null);
	assertEquals([d.canRespond, d.canEscalate, d.canResolve], [true, true, false]);
});

Deno.test("the review SLA maps when present and reads null on an older row", () => {
	assertEquals(
		toDisputeCase(raw({ review_by: "2026-10-16T11:00:00.000Z" }))!.reviewBy,
		"2026-10-16T11:00:00.000Z",
	);
	assertEquals(toDisputeCase(raw())!.reviewBy, null);
});

// #region The operator queue
function queueItem(over: Partial<RawQueueItem> = {}): RawQueueItem {
	return {
		id: ID,
		status: "under_review",
		kind: "no_show",
		reason: "The provider did not join the session.",
		opened_at: "2026-10-13T10:00:00.000Z",
		respond_by: "2026-10-15T10:00:00.000Z",
		escalated_at: "2026-10-13T11:00:00.000Z",
		review_by: "2026-10-16T11:00:00.000Z",
		overdue: true,
		amount_minor: 10000,
		currency: "GBP",
		project: { slug: "prj-abcdefghjk", title: "Coaching" },
		sitting: {
			title: "Kick-off",
			starts_at: "2026-10-13T08:00:00.000Z",
			ends_at: "2026-10-13T09:00:00.000Z",
		},
		claimant: { name: "  Ada Lovelace ", handle: "ada" },
		respondent: { name: null, handle: null },
		statements: 2,
		evidence: 1,
		...over,
	};
}

Deno.test("a queue row maps with its money, parties, deadline and counts", () => {
	const q = toDisputeQueue({
		items: [queueItem()],
		counts: { open: 1, awaiting_response: 2, under_review: 3, overdue: 1 },
	});
	assertEquals(DisputeQueueSchema.safeParse(q).success, true);
	const item = q.items[0];
	assertEquals(item.overdue, true);
	assertEquals(item.reviewBy, "2026-10-16T11:00:00.000Z");
	assertEquals(item.amountLabel.includes("100"), true);
	assertEquals(item.claimant, { name: "Ada Lovelace", handle: "ada" });
	assertEquals(item.respondent, { name: null, handle: null });
	assertEquals([item.statementCount, item.evidenceCount], [2, 1]);
	assertEquals(q.counts, { open: 1, awaitingResponse: 2, underReview: 3, overdue: 1 });
});

Deno.test("a queue drops a status it does not list and only an under-review case is overdue", () => {
	const q = toDisputeQueue({
		items: [
			queueItem({ status: "resolved_refund" }),
			queueItem({ status: "awaiting_response", overdue: true }),
		],
		counts: null,
	});
	assertEquals(q.items.length, 1);
	assertEquals(q.items[0].overdue, false);
	assertEquals(q.counts, { open: 0, awaitingResponse: 0, underReview: 0, overdue: 0 });
	assertEquals(toDisputeQueue(null).items, []);
});
// #endregion
