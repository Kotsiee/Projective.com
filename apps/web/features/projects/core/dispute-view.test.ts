import { assertEquals } from "@std/assert";
import { DisputeCaseSchema, type DisputeSummary } from "@projective/types/finance";
import type { SessionWorkspace } from "@projective/types/projects";
import {
	DEV_DISPUTE_ID,
	devDisputeCase,
	disputeSentence,
	disputeStatusLabel,
	disputeTimeLabel,
	liveDisputeFor,
	previewDisputes,
	visibleDisputes,
} from "./dispute-view.ts";

/*
 * The no-show section's words and its dev preview (Decision #212). The server decides every fact; a
 * wrong answer here would tell an attendee their money moved when it did not, or show the provider the
 * attendee's instructions.
 */

// #region Fixtures
const NOW = Date.parse("2026-10-13T12:00:00.000Z");
const SITTING = "55555555-5555-4555-8555-555555555555";

function summary(over: Partial<DisputeSummary> = {}): DisputeSummary {
	return {
		id: "66666666-6666-4666-8666-666666666666",
		status: "awaiting_response",
		sessionEventId: SITTING,
		respondBy: "2026-10-15T09:05:00.000Z",
		openedAt: "2026-10-13T11:00:00.000Z",
		resolvedAt: null,
		mine: true,
		...over,
	};
}

function workspace(role: SessionWorkspace["role"]): SessionWorkspace {
	return {
		projectId: "77777777-7777-4777-8777-777777777777",
		slug: "prj-abcdefghjk",
		kind: "normal",
		role,
		terms: {
			seatHoldMinutes: 15,
			joinLeadMinutes: 10,
			presenceMinutes: 15,
			cancelNoticeHours: 24,
			payoutHours: 24,
		},
		cohorts: [],
		next: {
			id: SITTING,
			title: "Kick-off",
			startsAt: "2026-10-13T11:30:00.000Z",
			endsAt: "2026-10-13T12:30:00.000Z",
			phase: "live",
			index: 1,
			total: 1,
		},
		join: null,
		curriculum: [],
		membership: null,
		funding: null,
		vote: null,
		proposal: null,
		presetEnded: false,
		claimable: null,
		disputes: [summary()],
	};
}
// #endregion

Deno.test("times read in UTC with the zone named", () => {
	assertEquals(disputeTimeLabel("2026-10-15T09:05:00.000Z"), "15 Oct, 09:05 UTC");
	assertEquals(disputeTimeLabel(null), null);
	assertEquals(disputeTimeLabel("not a date"), null);
});

Deno.test("each side reads its own sentence", () => {
	const d = summary();
	assertEquals(
		disputeSentence(d, "claimant").startsWith("The provider has been asked to respond by 15 Oct"),
		true,
	);
	assertEquals(
		disputeSentence(d, "respondent").startsWith("The room's logs don't settle it. Respond"),
		true,
	);
	assertEquals(
		disputeSentence(summary({ status: "resolved_refund" }), "claimant"),
		"The claim was upheld. Your payment was refunded.",
	);
	assertEquals(disputeStatusLabel("under_review"), "Under review");
});

Deno.test("the section lists every live claim and only the latest ruling", () => {
	const list = [
		summary({ id: "a", status: "under_review" }),
		summary({ id: "b", status: "resolved_release" }),
		summary({ id: "c", status: "open" }),
		summary({ id: "d", status: "resolved_refund" }),
	];
	assertEquals(visibleDisputes(list).map((d) => d.id), ["a", "c", "b"]);
	assertEquals(liveDisputeFor(list, SITTING)?.id, "a");
	assertEquals(liveDisputeFor(list, null), null);
});

Deno.test("the dev axis previews each state over the real workspace", () => {
	const ws = workspace("attendee");
	assertEquals(previewDisputes(ws, "auto", NOW), ws);
	assertEquals(previewDisputes(ws, "none", NOW).disputes, []);
	const reportable = previewDisputes(ws, "reportable", NOW);
	assertEquals([reportable.claimable?.id, reportable.disputes.length], [SITTING, 0]);
	const split = previewDisputes(ws, "resolved_split", NOW);
	assertEquals(split.disputes[0].id, DEV_DISPUTE_ID);
	assertEquals(split.disputes[0].status, "resolved_split");
	assertEquals(split.claimable, null);
});

Deno.test("a previewed case is a valid case on the viewer's side", () => {
	for (const role of ["attendee", "host"] as const) {
		const ws = workspace(role);
		for (const status of ["open", "awaiting_response", "under_review", "resolved_split"] as const) {
			const d = devDisputeCase(summary({ id: DEV_DISPUTE_ID, status }), ws, NOW);
			assertEquals(DisputeCaseSchema.safeParse(d).success, true, `${role}/${status}`);
			assertEquals(d.role, role === "host" ? "respondent" : "claimant");
		}
	}
});
