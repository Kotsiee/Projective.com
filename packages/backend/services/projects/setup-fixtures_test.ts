/**
 * Coverage of the setup surface's own branches.
 *
 * The Details form renders a different section set per `(format, structure)` and gates its Preview tab
 * on `status = 'draft'` versus anything else. Every one of those branches type-checks whether or not a
 * single project in the corpus can reach it — so the failure this file exists to catch is a branch
 * that is dead in the running app while the suite is green, which this repository has shipped before
 * (root CLAUDE.md §8 Decision #80: "a branch no fixture can reach is dead code").
 *
 * It asserts reachability, not appearance: that some owner-side engagement resolves each shape, and
 * that the ladder each one produces is internally coherent.
 */
import { assert, assertEquals } from "@std/assert";
import { previewReady, setupCompleteness } from "@projective/types/projects";
import type { ProjectSetup, ProjectStructure } from "@projective/types/projects";
import { allProjects } from "./fixtures.ts";
import { findProjectSetup } from "./setup-fixtures.ts";

/** Every configuration an owner can actually open, resolved once. */
function ownerSetups(): ProjectSetup[] {
	return allProjects()
		.map((row) => findProjectSetup(row.slug))
		.filter((s): s is ProjectSetup => s !== null && s.viewerIsClient);
}

// #region Reachability
Deno.test("the corpus reaches every structure the setup form renders a section set for", () => {
	const seen = new Set(ownerSetups().map((s) => s.structure));
	for (const structure of ["standard", "one_off", "single_task", "single_stage"] as const) {
		assert(
			seen.has(structure satisfies ProjectStructure),
			`No owner-side fixture resolves structure "${structure}", so that section set cannot be ` +
				`opened in the running app and its branch is dead code.`,
		);
	}
});

Deno.test("the corpus reaches a DRAFT engagement — the state View A is designed around", () => {
	const drafts = ownerSetups().filter((s) => s.status === "draft");
	assert(
		drafts.length > 0,
		"No owner-side DRAFT fixture exists, so the incomplete-setup state the Details surface is built " +
			"for cannot be reached, and neither can the locked Preview tab.",
	);
	// A draft with nothing configured is the case the ladder has to describe honestly.
	assert(
		drafts.some((s) => !s.previewReady),
		"Every owner draft is already preview-ready, so the LOCKED Preview tab never renders.",
	);
});

Deno.test("the corpus reaches a session engagement, and its kind is resolved rather than guessed", () => {
	const sessions = ownerSetups().filter((s) => s.format === "session");
	assert(
		sessions.length > 0,
		"No owner-side session fixture — the session section set is unreachable.",
	);
	for (const s of sessions) {
		assert(
			s.sessionKind === "normal" || s.sessionKind === "group",
			`A session engagement must carry a real session kind; "${s.slug}" carries "${s.sessionKind}".`,
		);
	}
});

Deno.test("a Direct Deliverable is staffed by roles and takes no stages", () => {
	const direct = ownerSetups().filter((s) => s.structure === "single_task");
	assert(direct.length > 0, "No Direct Deliverable fixture.");
	for (const s of direct) {
		assertEquals(s.stages.length, 0, `${s.slug}: a Direct Deliverable takes no stages.`);
		assert(s.roles.length > 0, `${s.slug}: a Direct Deliverable is staffed by roles.`);
		// The ladder must ask for roles, not stages — the whole reason the structure is distinguished.
		const staffing = s.steps.find((step) => step.key === "roles" || step.key === "stages");
		assertEquals(staffing?.key, "roles", `${s.slug}: the staffing step must be roles.`);
	}
});

Deno.test("a staged engagement is never asked to staff roles", () => {
	for (const s of ownerSetups().filter((x) => x.structure !== "single_task")) {
		const staffing = s.steps.find((step) => step.key === "roles" || step.key === "stages");
		assertEquals(staffing?.key, "stages", `${s.slug}: the staffing step must be stages.`);
		assertEquals(s.roles.length, 0, `${s.slug}: roles belong to a Direct Deliverable only.`);
	}
});
// #endregion

// #region Coherence
Deno.test("every resolved setup agrees with the helpers that derive its own ladder", () => {
	for (const s of ownerSetups()) {
		assertEquals(s.completeness, setupCompleteness(s.steps), `${s.slug}: completeness disagrees.`);
		assertEquals(s.previewReady, previewReady(s.steps), `${s.slug}: previewReady disagrees.`);
		assert(s.steps.length > 0, `${s.slug}: an empty ladder reports 0% forever.`);
	}
});

Deno.test("resolution is deterministic — a re-read is the same projection", () => {
	// SSR paints one answer and the client refetch paints another only if this is not true, and the
	// symptom is a form that appears to lose the owner's work on hydration.
	for (const s of ownerSetups()) {
		assertEquals(findProjectSetup(s.slug), s, `${s.slug}: two reads disagree.`);
	}
});

Deno.test("an unknown slug is a miss, not a fabricated blank project", () => {
	assertEquals(findProjectSetup("no-such-engagement"), null);
});
// #endregion
