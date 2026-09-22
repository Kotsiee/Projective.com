import { assert, assertEquals, assertFalse } from "@std/assert";
import {
	inviteActionFor,
	invitesForScope,
	type MemberInvite,
	NO_REMOVAL_IMPACT,
	removalNotices,
	removalTouchesMoney,
} from "./members.ts";

/**
 * The invitation-list rules, pinned.
 *
 * Each is a CLAIM the Members tab makes to a client: which control a record admits, which records a
 * stage page lists, and what removing somebody will do to their money. A wrong answer here renders a
 * control the write refuses, lists a stranger's invitation on a stage they were never invited to, or
 * tells a client a removal is free when it releases escrow — none of which a type-checker can see.
 */

function invite(overrides: Partial<MemberInvite> = {}): MemberInvite {
	return {
		id: "inv-1",
		email: "@juno",
		handle: "@juno",
		role: "freelancer",
		stageId: "stage-1",
		stageName: "Discovery",
		invitedBy: "Maris",
		invitedAt: "2026-07-10T10:00:00.000Z",
		invitedLabel: "2 days ago",
		status: "pending",
		...overrides,
	};
}

// #region inviteActionFor

Deno.test("each invitation state admits exactly one client action", () => {
	assertEquals(inviteActionFor("pending"), "cancel");
	assertEquals(inviteActionFor("declined"), "dismiss");
	assertEquals(inviteActionFor("expired"), "dismiss");
	assertEquals(inviteActionFor("accepted"), "remove");
});

// #endregion

// #region invitesForScope

Deno.test("a stage page lists only the invitations addressed to THAT stage", () => {
	const rows = [
		invite({ id: "a", stageId: "stage-1" }),
		invite({ id: "b", stageId: "stage-2" }),
		// A whole-project invitation names no stage: the person was invited to the engagement, not to
		// this stage, so a stage page does not list them.
		invite({ id: "c", stageId: null, stageName: null }),
	];
	assertEquals(invitesForScope(rows, "stage-1").map((r) => r.id), ["a"]);
	assertEquals(invitesForScope(rows, "stage-2").map((r) => r.id), ["b"]);
});

Deno.test("project scope lists every invitation, whatever stage it names", () => {
	const rows = [
		invite({ id: "a", stageId: "stage-1" }),
		invite({ id: "b", stageId: null, stageName: null }),
	];
	assertEquals(invitesForScope(rows, null).map((r) => r.id), ["a", "b"]);
});

Deno.test("a dismissed record is on no list, in either scope", () => {
	const rows = [
		invite({ id: "a", status: "declined", declinedAt: "2026-07-11T00:00:00.000Z" }),
		invite({
			id: "b",
			status: "declined",
			declinedAt: "2026-07-11T00:00:00.000Z",
			dismissedAt: "2026-07-12T00:00:00.000Z",
		}),
	];
	assertEquals(invitesForScope(rows, null).map((r) => r.id), ["a"]);
	assertEquals(invitesForScope(rows, "stage-1").map((r) => r.id), ["a"]);
});

// #endregion

// #region removalNotices

Deno.test("a member with no work under way is stated as a free removal — positively, not by silence", () => {
	const notices = removalNotices(NO_REMOVAL_IMPACT);
	assertEquals(notices.length, 1);
	assert(notices[0].includes("no financial consequence"));
	assertFalse(removalTouchesMoney(NO_REMOVAL_IMPACT));
	// An absent impact is the neutral value, never a guess.
	assertEquals(removalNotices(undefined), notices);
	assertEquals(removalNotices(null), notices);
});

Deno.test("a claimed ticket releases its escrow to the freelancer and returns to New", () => {
	const impact = { claimedTickets: 1, submittedTickets: 0, startedStages: 0 };
	const notices = removalNotices(impact);
	assertEquals(notices.length, 1);
	assert(notices[0].startsWith("1 claimed ticket is under way"));
	assert(notices[0].includes("released to them in full"));
	assert(notices[0].includes("ticket returns to New"));
	assert(removalTouchesMoney(impact));
});

Deno.test("plurals agree with their counts", () => {
	const [line] = removalNotices({ claimedTickets: 3, submittedTickets: 0, startedStages: 0 });
	assert(line.startsWith("3 claimed tickets are under way"));
	assert(line.includes("tickets return to New"));
});

Deno.test("a submitted ticket is still held work — paid out, and its files stay", () => {
	const impact = { claimedTickets: 0, submittedTickets: 2, startedStages: 0 };
	const [line] = removalNotices(impact);
	assert(line.startsWith("2 submitted tickets are awaiting your review"));
	assert(line.includes("escrow releases to them in full"));
	assert(line.includes("submitted files stay on the project"));
	assert(removalTouchesMoney(impact));
});

Deno.test("a started stage with nothing claimed is a seat opening, not a payout", () => {
	const impact = { claimedTickets: 0, submittedTickets: 0, startedStages: 1 };
	const [line] = removalNotices(impact);
	assert(line.includes("1 stage already under way"));
	assert(line.includes("That seat opens up"));
	assertFalse(removalTouchesMoney(impact), "a seat opening moves no money");
});

Deno.test("every fact under way gets its own sentence, in a fixed order", () => {
	const notices = removalNotices({ claimedTickets: 1, submittedTickets: 1, startedStages: 2 });
	assertEquals(notices.length, 3);
	assert(notices[0].includes("claimed ticket"));
	assert(notices[1].includes("submitted ticket"));
	assert(notices[2].includes("2 stages already under way"));
	assert(notices[2].includes("Those seats open up"));
});

// #endregion
