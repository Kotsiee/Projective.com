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
import { assert, assertEquals, assertFalse } from "@std/assert";
import {
	blankStage,
	previewReady,
	reconcileSetup,
	setupCompleteness,
} from "@projective/types/projects";
import type { ProjectSetup, ProjectStructure, StageSetup } from "@projective/types/projects";
import { allProjects } from "./fixtures.ts";
import {
	applyOnboardingSim,
	effectiveOnboardingSim,
	findProjectSetup,
	isOnboardingSim,
} from "./setup-fixtures.ts";

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

// #region Onboarding simulation (development only)
/**
 * The Dev Context Switcher's onboarding simulation, pinned.
 *
 * It exists so a developer can reach the post-onboarding locks without genuinely hiring somebody, and
 * every assertion here is about it being HONEST rather than convenient. Two properties carry the
 * weight: it must produce a projection indistinguishable from a genuinely staffed one — otherwise it
 * demonstrates a state the product cannot actually be in — and it must be refused outside
 * development, because it moves a gate and arrives on a caller-controlled query string.
 *
 * `first_stage` is the case worth having at all. Which of a real fixture's stages are staffed depends
 * on that project's own progress, so "exactly one stage is filled" is the state a corpus cannot be
 * relied on to show, and it is the only state that proves the price lock is per stage.
 */

/** A staged engagement with three unstaffed stages. */
function setupOf(stages: StageSetup[], structure: "standard" | "single_task" = "standard") {
	return reconcileSetup({
		id: "p1",
		slug: "prj-abcdefghij",
		title: "Rebrand",
		structure,
		stages,
		onboardedCount: 0,
		viewerIsClient: true,
	});
}

const threeStages = () => [
	blankStage("s1", "Discovery", 0),
	blankStage("s2", "Concepts", 1),
	blankStage("s3", "Delivery", 2),
];

Deno.test("auto changes nothing at all", () => {
	// The default, and the one value that must be indistinguishable from the axis not existing.
	const real = setupOf(threeStages());
	assertEquals(applyOnboardingSim(real, "auto"), real);
});

Deno.test("none clears every count, project and stage alike", () => {
	const staffed = setupOf(threeStages().map((s) => ({ ...s, onboardedCount: 4 })));
	const simulated = applyOnboardingSim(staffed, "none");
	assertEquals(simulated.onboardedCount, 0);
	assertEquals(simulated.stages.map((s) => s.onboardedCount), [0, 0, 0]);
});

Deno.test("first_stage staffs exactly the first stage", () => {
	// The state a real fixture cannot be relied on to produce, and the only one that distinguishes a
	// per-stage lock from a per-project one.
	const simulated = applyOnboardingSim(setupOf(threeStages()), "first_stage");
	assertEquals(simulated.stages.map((s) => s.onboardedCount), [1, 0, 0]);
	assertEquals(simulated.onboardedCount, 1);
});

Deno.test("all_stages staffs every stage and totals them", () => {
	const simulated = applyOnboardingSim(setupOf(threeStages()), "all_stages");
	assertEquals(simulated.stages.map((s) => s.onboardedCount), [1, 1, 1]);
	assertEquals(simulated.onboardedCount, 3);
});

Deno.test("a role-staffed engagement is still simulated as staffed", () => {
	// It renders no stage list, so a total derived purely from stages would leave the one shape whose
	// price lives on the project row permanently unlocked however the switcher was set — which is the
	// floor's whole reason for existing.
	const simulated = applyOnboardingSim(setupOf([], "single_task"), "all_stages");
	assertEquals(simulated.stages.length, 0);
	assertEquals(simulated.onboardedCount, 1);
});

Deno.test("a simulated projection re-derives its ladder rather than carrying the real one", () => {
	// It goes back through `reconcileSetup`, so the percentage and the Preview gate describe the
	// simulated shape. A spread would leave the derived trio describing a project that is no longer
	// the one being rendered.
	const simulated = applyOnboardingSim(setupOf(threeStages()), "all_stages");
	assertEquals(simulated.steps.length > 0, true);
	assertEquals(simulated.completeness, setupOf(threeStages()).completeness);
});

Deno.test("only the four members are accepted from the wire", () => {
	// The route's guard. Anything else is dropped rather than cast, so a caller cannot smuggle a value
	// the service has no branch for.
	for (const ok of ["auto", "none", "first_stage", "all_stages"]) assert(isOnboardingSim(ok));
	for (const bad of ["", "ALL_STAGES", "first-stage", "staffed", "1"]) {
		assertFalse(isOnboardingSim(bad));
	}
});

Deno.test("the simulation is refused outside development", () => {
	// It moves a lock and it arrives on a caller-controlled query string, so the environment — read by
	// the SERVER, never asserted by the client — has the last word. Decision #72 had to retrofit this
	// shape after an ungated dev overlay turned out to be a privilege-forgery primitive in production.
	const prior = Deno.env.get("DENO_ENV");
	try {
		Deno.env.set("DENO_ENV", "production");
		assertEquals(effectiveOnboardingSim("all_stages"), "auto");
		Deno.env.set("DENO_ENV", "development");
		assertEquals(effectiveOnboardingSim("all_stages"), "all_stages");
		// `auto` and absence are the same request either way.
		assertEquals(effectiveOnboardingSim(undefined), "auto");
		assertEquals(effectiveOnboardingSim("auto"), "auto");
	} finally {
		if (prior === undefined) Deno.env.delete("DENO_ENV");
		else Deno.env.set("DENO_ENV", prior);
	}
});
// #endregion
