import { assert, assertEquals } from "@std/assert";
import {
	byNewest,
	clamp,
	clampOr,
	DELIVERED_STAGE_STATUS,
	partyName,
	partyOf,
	senderOf,
	toInviteStatus,
	toMemberRole,
	toStageProjectStatus,
	toSubmissionStatus,
	toTicketStatus,
} from "./live-support.ts";

/**
 * live-support_test — the enum reconciliations, pinned against the migrations.
 *
 * These tests are worth more than their size suggests. Every function here exists because a Postgres
 * enum and a Zod enum disagree, and that disagreement is invisible from either file alone: nothing in
 * `packages/types` mentions `revisions_requested`, and nothing in the migrations mentions
 * `revision_requested`. Twice during this work a value was written that the database cannot produce
 * (`profile_type = 'user'`, `stage_status = 'completed'`), and in both cases the failure was silent —
 * one swallowed by an error-tolerant lookup, the other rendering a plausible "0/5".
 *
 * So each test below asserts against the LITERAL member list in the migration, quoted in the test
 * name. If somebody edits an enum, these fail; if somebody edits a mapping to match a member that
 * does not exist, these fail. That is the whole job.
 */

// #region The exact enum members, as the migrations spell them

/** `projects.stage_submissions.status` CHECK — note the PLURAL "revisions". */
const DB_SUBMISSION_STATUS = [
	"draft",
	"pending_review",
	"accepted",
	"revisions_requested",
] as const;

/** `stage_status` from `00000003_enums_core.sql`. There is no `completed`. */
const DB_STAGE_STATUS = [
	"open",
	"assigned",
	"in_progress",
	"submitted",
	"approved",
	"revisions",
	"paid",
	"cancelled",
] as const;

/** `projects.project_invitations.status` CHECK. */
const DB_INVITE_STATUS = ["pending", "accepted", "expired", "revoked"] as const;

/** The Zod `ProjectStatus` members a stage projection can carry. */
const ZOD_PROJECT_STATUS = ["draft", "active", "on_hold", "completed", "cancelled"];

// #endregion

// #region Submission status — the singular/plural trap

Deno.test("toSubmissionStatus maps the DB's PLURAL revisions_requested onto Zod's singular", () => {
	// The whole reason this function exists. Without it every revision row fails Zod parse, which is
	// a thrown page read rather than a missing badge.
	assertEquals(toSubmissionStatus("revisions_requested"), "revision_requested");
});

Deno.test("toSubmissionStatus accepts every value the DB CHECK allows", () => {
	for (const member of DB_SUBMISSION_STATUS) {
		const out = toSubmissionStatus(member);
		assert(
			["draft", "pending_review", "revision_requested", "accepted"].includes(out),
			`${member} mapped to ${out}, which is not a SubmissionStatus member`,
		);
	}
});

Deno.test("toSubmissionStatus resolves NULL to draft", () => {
	// The column is NULLABLE and a SQL CHECK is NULL-tolerant, so an explicit NULL is storable, passes
	// the constraint, and fails the required Zod field. A submission with no recorded status has not
	// been sent for review, which is what draft means.
	assertEquals(toSubmissionStatus(null), "draft");
	assertEquals(toSubmissionStatus(undefined), "draft");
});

Deno.test("toSubmissionStatus also accepts the Zod spelling, so a future reconciliation survives", () => {
	assertEquals(toSubmissionStatus("revision_requested"), "revision_requested");
});

// #endregion

// #region Stage status — two enums sharing one member

Deno.test("stage_status and ProjectStatus share exactly ONE member — the reason a map is needed", () => {
	const shared = DB_STAGE_STATUS.filter((m) => (ZOD_PROJECT_STATUS as string[]).includes(m));
	assertEquals(shared, ["cancelled"], `unexpected overlap: ${shared.join(", ")}`);
});

Deno.test("toStageProjectStatus maps every real stage_status member to a valid ProjectStatus", () => {
	for (const member of DB_STAGE_STATUS) {
		const out = toStageProjectStatus(member);
		assert(
			ZOD_PROJECT_STATUS.includes(out),
			`${member} mapped to ${out}, which is not a ProjectStatus member`,
		);
	}
});

Deno.test("only `open` maps to draft — the value stageLocked() tests for", () => {
	// `stageLocked(stage) = stage.status !== "draft"`, so anything that wrongly maps to draft silently
	// UNLOCKS a stage. Only a stage nobody has been assigned to may be draft.
	const toDraft = DB_STAGE_STATUS.filter((m) => toStageProjectStatus(m) === "draft");
	assertEquals(toDraft, ["open"]);
});

Deno.test("submitted is active, not completed — awaiting review is not done", () => {
	assertEquals(toStageProjectStatus("submitted"), "active");
	assertEquals(toStageProjectStatus("revisions"), "active");
});

Deno.test("approved and paid are the terminal pair, and match DELIVERED_STAGE_STATUS", () => {
	assertEquals(toStageProjectStatus("approved"), "completed");
	assertEquals(toStageProjectStatus("paid"), "completed");
	// The progress meter and the status projection must agree about what "delivered" means, or a
	// finished project reads 0/5 beside a "Completed" label.
	const completed = DB_STAGE_STATUS.filter((m) => toStageProjectStatus(m) === "completed");
	assertEquals(new Set(completed), DELIVERED_STAGE_STATUS);
});

Deno.test("DELIVERED_STAGE_STATUS contains no member the enum lacks", () => {
	// The bug this pins: counting against `"completed"`, which stage_status does not contain, made
	// completedStages permanently 0 while the total stayed right.
	for (const member of DELIVERED_STAGE_STATUS) {
		assert(
			(DB_STAGE_STATUS as readonly string[]).includes(member),
			`"${member}" is not a stage_status member`,
		);
	}
});

Deno.test("an unknown stage status is active, not draft — the safer way to be wrong", () => {
	assertEquals(toStageProjectStatus("something_new"), "active");
	assertEquals(toStageProjectStatus(null), "active");
});

// #endregion

// #region Invite status — four DB values, two Zod members

Deno.test("toInviteStatus returns null for the two states Zod cannot express", () => {
	assertEquals(toInviteStatus("accepted"), null);
	assertEquals(toInviteStatus("revoked"), null);
	// Coercing them to `expired` would be a lie: an accepted invitation is not an expired one, and
	// this feeds the PENDING queue.
	assertEquals(toInviteStatus("pending"), "pending");
	assertEquals(toInviteStatus("expired"), "expired");
});

Deno.test("toInviteStatus handles every value the DB CHECK allows without throwing", () => {
	for (const member of DB_INVITE_STATUS) {
		const out = toInviteStatus(member);
		assert(out === null || out === "pending" || out === "expired");
	}
});

// #endregion

// #region Participant role — free text with one written value

Deno.test("toMemberRole maps `assignee`, the only role any migration writes", () => {
	// `projects.project_participants.role` has no CHECK and no default, and the staffing RPC writes
	// exactly this. Without the branch every hired freelancer reads as a bare `member`.
	assertEquals(toMemberRole("assignee"), "freelancer");
});

Deno.test("toMemberRole passes through the MemberRole members and defaults the rest", () => {
	for (const r of ["client", "owner", "admin", "manager", "freelancer", "guest"]) {
		assertEquals(toMemberRole(r), r);
	}
	assertEquals(toMemberRole("something_else"), "member");
	assertEquals(toMemberRole(null), "member");
});

// #endregion

// #region Ticket status

Deno.test("toTicketStatus accepts every ticket_status member and defaults the unknown", () => {
	for (
		const m of [
			"backlog",
			"todo",
			"claimed",
			"in_progress",
			"in_review",
			"completed",
			"cancelled",
			"reported_hidden",
		]
	) {
		assertEquals(toTicketStatus(m), m);
	}
	assertEquals(toTicketStatus("nonsense"), "backlog");
	assertEquals(toTicketStatus(null), "backlog");
});

// #endregion

// #region Truncation — the contract that keeps a long row from 500ing a page

Deno.test("clamp truncates to the bound and tolerates null", () => {
	assertEquals(clamp("abcdef", 3), "abc");
	assertEquals(clamp("ab", 5), "ab");
	assertEquals(clamp(null, 5), "");
	assertEquals(clamp(undefined, 5), "");
});

Deno.test("clampOr supplies a fallback, because min(1) cannot carry an empty string", () => {
	assertEquals(clampOr(null, 10, "Untitled"), "Untitled");
	assertEquals(clampOr("   ", 10, "Untitled"), "Untitled");
	assertEquals(clampOr("Real", 10, "Untitled"), "Real");
	assertEquals(clampOr("abcdefghijk", 4, "Untitled"), "abcd");
});

// #endregion

// #region Parties

Deno.test("partyName composes given+family, falls back to username, then to Unknown", () => {
	const row = { user_id: "u", username: "ahmed", first_name: "Ahmed", last_name: "Kotwal" };
	assertEquals(partyName(row), "Ahmed Kotwal");
	assertEquals(partyName({ ...row, first_name: null, last_name: null }), "ahmed");
	assertEquals(partyName(undefined), "Unknown");
});

Deno.test("partyName never returns an empty string — every name field is min(1)", () => {
	const blank = { user_id: "u", username: "   ", first_name: "  ", last_name: null };
	assert(partyName(blank).length > 0);
});

Deno.test("a party's avatar is always null — avatar_file_id is a file id, not a URL", () => {
	const row = { user_id: "u", username: "ahmed", first_name: "A", last_name: "K" };
	assertEquals(partyOf(row).avatar, null);
	assertEquals(partyOf(row).handle, "ahmed");
	assertEquals(senderOf("u", row).id, "u");
	assertEquals(partyOf(undefined).handle, null);
});

// #endregion

// #region Ordering

Deno.test("byNewest sorts newest first and puts nulls last", () => {
	const rows = [
		{ at: null as string | null },
		{ at: "2026-01-01T00:00:00Z" },
		{ at: "2026-06-01T00:00:00Z" },
		{ at: "not a date" },
	];
	const sorted = [...rows].sort((a, b) => byNewest(a.at, b.at));
	assertEquals(sorted[0].at, "2026-06-01T00:00:00Z");
	assertEquals(sorted[1].at, "2026-01-01T00:00:00Z");
	// Both the null and the unparseable land after the real dates rather than wherever the engine's
	// NaN comparisons happen to leave them.
	assert(sorted[2].at === null || sorted[2].at === "not a date");
	assert(sorted[3].at === null || sorted[3].at === "not a date");
});

// #endregion
