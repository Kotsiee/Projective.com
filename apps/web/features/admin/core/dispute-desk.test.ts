import { assertEquals } from "@std/assert";
import {
	DisputeCaseSchema,
	DisputeQueueSchema,
	DisputeResolveInputSchema,
} from "@projective/types/finance";
import {
	confirmSentence,
	deadlineLine,
	DESK_TABS,
	evidenceLine,
	isPreviewCase,
	itemsFor,
	partyLabel,
	previewCase,
	previewQueue,
	rulingProblem,
	shareToBp,
	tabCount,
} from "./dispute-desk.ts";

/*
 * The operator dispute desk's pure model (Decision #212). The ruling form must refuse exactly what the
 * route's Zod refuses, a share must reach the database as the basis points the operator meant, and the
 * dev preview must be shapes the SSOT accepts.
 */

const NOW = Date.parse("2026-10-13T12:00:00.000Z");

Deno.test("a share in percent becomes basis points, and only a splittable one", () => {
	assertEquals(shareToBp(25), 2500);
	assertEquals(shareToBp(33.33), 3333);
	assertEquals(shareToBp(0.01), 1);
	assertEquals(shareToBp(99.99), 9999);
	assertEquals(shareToBp(0), null);
	assertEquals(shareToBp(100), null);
	assertEquals(shareToBp(null), null);
	assertEquals(shareToBp(Number.NaN), null);
});

Deno.test("the ruling form refuses what the route's schema refuses", () => {
	const cases: Array<[Parameters<typeof rulingProblem>, boolean]> = [
		[[null, null, "Reasons given."], false],
		[["release", null, "ok"], false],
		[["release", null, "  Reasons given.  "], true],
		[["refund", null, "x".repeat(2000)], true],
		[["refund", null, "x".repeat(2001)], false],
		[["split", null, "Reasons given."], false],
		[["split", 0, "Reasons given."], false],
		[["split", 40, "Reasons given."], true],
	];
	for (const [[outcome, share, notes], valid] of cases) {
		assertEquals(
			rulingProblem(outcome, share, notes) === null,
			valid,
			`${outcome} ${share} ${notes.length}`,
		);
		if (!outcome) continue;
		const parsed = DisputeResolveInputSchema.safeParse({
			outcome,
			payeeShareBp: outcome === "split" ? shareToBp(share) : null,
			notes,
		});
		assertEquals(parsed.success, valid, `schema: ${outcome} ${share} ${notes.length}`);
	}
});

Deno.test("the confirm says what the ruling does", () => {
	assertEquals(
		confirmSentence("split", 25, "£120.00"),
		"Give the provider 25 % of the £120.00 held and refund the rest. This is final.",
	);
	assertEquals(confirmSentence("refund", null, "£120.00").startsWith("Refund the £120.00"), true);
});

Deno.test("the preview queue is a valid queue with every live status and one overdue case", () => {
	const q = previewQueue("queue", NOW);
	assertEquals(DisputeQueueSchema.safeParse(q).success, true);
	assertEquals(q.items.map((i) => i.status), [
		"under_review",
		"under_review",
		"awaiting_response",
		"open",
	]);
	assertEquals(q.items.filter((i) => i.overdue).length, q.counts.overdue);
	for (const t of DESK_TABS) assertEquals(itemsFor(q.items, t).length, tabCount(t, q.counts), t);
	assertEquals(previewQueue("empty", NOW).items, []);
	for (const item of q.items) {
		assertEquals(isPreviewCase(item.id), true);
		const d = previewCase(item);
		assertEquals(DisputeCaseSchema.safeParse(d).success, true, item.id);
		assertEquals([d.role, d.canResolve], ["operator", true]);
	}
	assertEquals(isPreviewCase("11111111-1111-4111-8111-111111111111"), false);
});

Deno.test("names, deadlines and evidence read as one meta line", () => {
	assertEquals(partyLabel({ name: "Ada", handle: "ada" }, "Attendee"), "Ada");
	assertEquals(partyLabel({ name: null, handle: "ada" }, "Attendee"), "@ada");
	assertEquals(partyLabel({ name: null, handle: null }, "Attendee"), "Attendee");
	const [overdue, due, awaiting, open] = previewQueue("queue", NOW).items;
	assertEquals(deadlineLine(overdue).startsWith("Ruling overdue since "), true);
	assertEquals(deadlineLine(due).startsWith("Ruling due "), true);
	assertEquals(deadlineLine(awaiting).startsWith("Response due "), true);
	assertEquals(deadlineLine(open).startsWith("Raised "), true);
	assertEquals(evidenceLine({ statementCount: 0, evidenceCount: 0 }), "No statements yet");
	assertEquals(evidenceLine({ statementCount: 1, evidenceCount: 0 }), "1 statement");
	assertEquals(evidenceLine({ statementCount: 3, evidenceCount: 2 }), "3 statements · 2 files");
});
