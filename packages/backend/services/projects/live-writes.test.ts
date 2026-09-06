/**
 * Coverage of the two reconciliation RULES the live write path applies to a project's dependent
 * rows: the staffing roles hanging off each stage, and the reference files hanging off the project.
 *
 * Both were GATE 11 defects before these functions existed — the Stage-2 form rendered a full editor
 * for each, the stub path persisted both, and the live path wrote neither. That failure shape is the
 * dangerous one: the feature works with `PROJECTS_BACKEND_LIVE` off and silently discards the owner's
 * work with it on, so it passes every test anyone runs in development and loses data in production.
 *
 * Only the rules are asserted here, and deliberately so. Everything else in `reconcileStageRoles` and
 * `reconcileAttachments` is RLS-scoped PostgREST I/O, which this repository cannot execute (root
 * CLAUDE.md §8 Decision #67(a) — no Docker, no psql), so the half that CAN be pinned is pinned rather
 * than reasoned about, and the statements are reviewed at the site that issues them.
 */
import { assert, assertEquals } from "@std/assert";
import {
	type ProjectAttachment,
	type StageStaffingRole,
	StageStaffingRoleSchema,
} from "@projective/types/projects";
import {
	type LockState,
	onboardingLockRefusal,
	planAttachments,
	planStageRoles,
	stageTermsPatch,
	touchesLockableFields,
} from "./live-writes.ts";

/** A stored role id, in the shape the column actually holds. */
function storedId(): string {
	return crypto.randomUUID();
}

/** A submitted role. Its bonus is optional, so the fixture carries none unless told otherwise. */
function role(id: string, overrides: Partial<StageStaffingRole> = {}): StageStaffingRole {
	return {
		id,
		name: "Illustrator",
		quantity: 1,
		description: "",
		budgetCents: null,
		...overrides,
	};
}

/** A submitted attachment. Only the id participates in the reconciliation. */
function attachment(id: string): ProjectAttachment {
	return { id, name: "brief.pdf", sizeBytes: 4096 };
}

/** The ids a plan names, in the order it named them. */
function ids(roles: readonly StageStaffingRole[]): string[] {
	return roles.map((r) => r.id);
}

// #region Stage staffing roles
Deno.test("a draft-prefixed id is a CREATE — the client minted it, so no row answers to it", () => {
	const plan = planStageRoles([], [role("role-draft-1"), role("role-draft-2")]);
	assertEquals(ids(plan.create), ["role-draft-1", "role-draft-2"]);
	assertEquals(plan.update, []);
	assertEquals(plan.remove, []);
});

Deno.test("an id that is not a uuid is a CREATE, never an UPDATE", () => {
	// The whole point of the shape test: `.eq("id", "role-7")` on a uuid column does not miss, it
	// raises `22P02` — a thrown save in the middle of a form submit, where the caller expected a
	// validation message. Fixture-shaped ids reach the live path exactly this way when the backend
	// gate is flipped mid-session.
	const plan = planStageRoles([], [role("role-7")]);
	assertEquals(ids(plan.create), ["role-7"]);
	assertEquals(plan.update, []);
});

Deno.test("a real uuid is an UPDATE and is kept, not re-created", () => {
	const kept = storedId();
	const plan = planStageRoles([kept], [role(kept, { name: "Art director" })]);
	assertEquals(plan.create, []);
	assertEquals(ids(plan.update), [kept]);
	assertEquals(plan.update[0].name, "Art director");
	assertEquals(plan.remove, []);
});

Deno.test("a stored id the payload no longer names is a REMOVE", () => {
	const kept = storedId();
	const dropped = storedId();
	const plan = planStageRoles([kept, dropped], [role(kept)]);
	assertEquals(ids(plan.update), [kept]);
	assertEquals(plan.remove, [dropped]);
});

Deno.test("an empty list removes every stored role — clearing the editor is a real intent", () => {
	const stored = [storedId(), storedId()];
	const plan = planStageRoles(stored, []);
	assertEquals(plan.create, []);
	assertEquals(plan.update, []);
	assertEquals(plan.remove, stored);
});

Deno.test("all three cases resolve in one pass without interfering", () => {
	const kept = storedId();
	const dropped = storedId();
	const plan = planStageRoles([kept, dropped], [role(kept), role("role-draft-new")]);
	assertEquals(ids(plan.create), ["role-draft-new"]);
	assertEquals(ids(plan.update), [kept]);
	assertEquals(plan.remove, [dropped]);
});

Deno.test("a uuid the stage does not store is still an UPDATE, so a stale client is refused", () => {
	// It affects zero rows and is reported through `notWritten`, which refuses the save. Classifying
	// it as a create instead would answer a stale editor by silently duplicating the role it thought
	// it was editing — and a duplicate staffing role is a second seat somebody can be hired into.
	const stranger = storedId();
	const plan = planStageRoles([], [role(stranger)]);
	assertEquals(plan.create, []);
	assertEquals(ids(plan.update), [stranger]);
});

Deno.test("a repeated id is folded to ONE update rather than two racing statements", () => {
	const twice = storedId();
	const plan = planStageRoles([twice], [
		role(twice, { name: "First" }),
		role(twice, {
			name: "Second",
		}),
	]);
	assertEquals(ids(plan.update), [twice]);
	assertEquals(plan.update[0].name, "First");
	// And the fold must not then read as "unnamed", which would delete the row it just updated.
	assertEquals(plan.remove, []);
});

Deno.test("a role's bonus is optional, and zero stays distinguishable from absent", () => {
	// This used to pin the OPPOSITE rule: the write refused an unpriced role, on the reasoning that
	// the column could not express one. The column is nullable and the figure is a BONUS on top of the
	// stage's ticket price, so no bonus is the ordinary case — the refusal is gone, and what has to
	// hold instead is that the schema accepts `null` and does not fold it onto `0`.
	const absent = StageStaffingRoleSchema.safeParse(role("role-draft-1", { budgetCents: null }));
	assert(absent.success, "an unpriced role must remain expressible — most roles carry no bonus");
	assertEquals(absent.success && absent.data.budgetCents, null);

	// Zero is a bonus somebody deliberately set to nothing, which is a different fact from not setting
	// one. Both must survive the round trip as themselves.
	const zero = StageStaffingRoleSchema.safeParse(role("role-draft-2", { budgetCents: 0 }));
	assert(zero.success);
	assertEquals(zero.success && zero.data.budgetCents, 0);
});

Deno.test("a role's additional instructions reach the write", () => {
	// The gate-11 check for the field this pass added: a control that renders, accepts input and is
	// discarded by the write is invisible to a type checker and to a source-reading review.
	const parsed = StageStaffingRoleSchema.safeParse(
		role("role-draft-1", { description: "Owns the component library." }),
	);
	assert(parsed.success);
	assertEquals(parsed.success && parsed.data.description, "Owns the component library.");
});
// #endregion

// #region Project attachments
Deno.test("an id with no link row is ATTACHED", () => {
	const added = storedId();
	const plan = planAttachments([], [attachment(added)]);
	assertEquals(plan.attach, [added]);
	assertEquals(plan.detach, []);
});

Deno.test("a linked id the desired set no longer names is DETACHED", () => {
	const kept = storedId();
	const dropped = storedId();
	const plan = planAttachments([kept, dropped], [attachment(kept)]);
	assertEquals(plan.attach, []);
	assertEquals(plan.detach, [dropped]);
});

Deno.test("an unchanged list writes NOTHING", () => {
	// Load-bearing rather than an optimisation: every statement here is a chance for a policy to
	// refuse and leave the save half-committed, so a save that touched no attachment must issue none.
	const stored = [storedId(), storedId()];
	const plan = planAttachments(stored, stored.map(attachment));
	assertEquals(plan.attach, []);
	assertEquals(plan.detach, []);
});

Deno.test("an empty list detaches everything", () => {
	const stored = [storedId(), storedId()];
	const plan = planAttachments(stored, []);
	assertEquals(plan.attach, []);
	assertEquals(plan.detach, stored);
});

Deno.test("a repeated id is ONE link, not a duplicate-key error mid-save", () => {
	// The primary key is `(project_id, attachment_id)`, so inserting the same file twice aborts the
	// statement — and the owner has no way to correct a payload the form generated.
	const twice = storedId();
	const plan = planAttachments([], [attachment(twice), attachment(twice)]);
	assertEquals(plan.attach, [twice]);
});

Deno.test("a repeated id that is already linked is neither attached nor detached", () => {
	const twice = storedId();
	const plan = planAttachments([twice], [attachment(twice), attachment(twice)]);
	assertEquals(plan.attach, []);
	assertEquals(plan.detach, []);
});

Deno.test("attach and detach resolve together in one pass", () => {
	const kept = storedId();
	const dropped = storedId();
	const added = storedId();
	const plan = planAttachments([kept, dropped], [attachment(kept), attachment(added)]);
	assertEquals(plan.attach, [added]);
	assertEquals(plan.detach, [dropped]);
});
// #endregion

// #region Stage terms reach a column
Deno.test("every stage term the form edits reaches a column", () => {
	// The gate-11 check, as an assertion. Each of these is a real control on the setup surface, and a
	// term missing here renders, accepts input, reports "Saved" and is discarded — while the STUB
	// branch persists it through `reconcileSetup`, so it works in dev and vanishes in production.
	// `skills` and `milestone` shipped exactly that way and are why this test exists.
	const patch = stageTermsPatch({
		id: "stage-1",
		tasks: [{ id: "t1", text: "Wireframes" }],
		skills: ["Figma", "Copywriting"],
		milestone: "Concepts signed off",
		dependency: "sequential",
		startsWithId: "stage-0",
		delayDays: -3,
		deliveryDate: "2026-11-20",
		allowedFileKinds: ["image", "pdf"],
		ndaRequired: true,
		capacity: "limited",
		seatCount: 3,
	});

	assertEquals(patch.default_tasks, [{ id: "t1", text: "Wireframes" }]);
	assertEquals(patch.skills, ["Figma", "Copywriting"]);
	assertEquals(patch.milestone, "Concepts signed off");
	assertEquals(patch.start_dependency_stage_id, "stage-0");
	// Signed, and NOT clamped to zero: a negative lag is the overlap a real schedule has, where the
	// next stage picks up before the previous one is signed off.
	assertEquals(patch.start_dependency_lag_days, -3);
	// A calendar date becomes the instant the `timestamptz` column holds, named as UTC so the stored
	// day cannot drift with whichever machine wrote it.
	assertEquals(patch.file_due_date, "2026-11-20T00:00:00Z");
	assertEquals(patch.allowed_file_kinds, ["image", "pdf"]);
	assertEquals(patch.nda_required, true);
	assertEquals(patch.capacity, "limited");
	assertEquals(patch.seat_count, 3);
	assert("start_trigger_type" in patch, "the dependency mode must reach a column");
});

Deno.test("an absent term is not restated, so a PATCH cannot blank an untouched field", () => {
	const patch = stageTermsPatch({ id: "stage-1", skills: ["Figma"] });
	assertEquals(Object.keys(patch).sort(), ["skills"]);
});

Deno.test("an emptied milestone is the empty string, never null", () => {
	// `project_stages.milestone` is `NOT NULL DEFAULT ''`, so writing null aborts the statement — and
	// the read already treats `''` as "no milestone named", so the two agree.
	assertEquals(stageTermsPatch({ id: "s", milestone: "" }).milestone, "");
});

Deno.test("a blank skill is dropped rather than stored", () => {
	// A `Chips` control yields whatever was typed. A whitespace skill is a row nothing can match
	// against, and it would still occupy one of the ten slots the brief caps this at.
	assertEquals(
		stageTermsPatch({ id: "s", skills: ["Figma", "   ", "", "Copywriting"] }).skills,
		["Figma", "Copywriting"],
	);
});

Deno.test("the seat pair is written together or not at all", () => {
	// `ck_project_stages_seat_count` is bidirectional: writing one half aborts the statement.
	const onlyCount = stageTermsPatch({ id: "s", seatCount: 4 });
	assertEquals(onlyCount.capacity, "limited");
	assertEquals(onlyCount.seat_count, 4);

	const unlimited = stageTermsPatch({ id: "s", capacity: "unlimited", seatCount: 9 });
	assertEquals(unlimited.capacity, "unlimited");
	assertEquals(unlimited.seat_count, null);
});
// #endregion

// #region Post-onboarding immutability — the server half
/**
 * The write path's refusal of a term somebody has already been hired against.
 *
 * These are the half that actually holds. The form disables the same controls, but a disabled input
 * is a courtesy to the person using the form and says nothing about the endpoint behind it — and this
 * endpoint accepts a hand-rolled `PATCH` from anyone who can read the project.
 *
 * The case that carries the most weight is the UNCHANGED one. This surface's `toPayload` sends the
 * whole form on every save, so `format`, `structure` and every stage price ride along on a request
 * that only renamed the project; a guard that refused on presence rather than on CHANGE would make a
 * staffed engagement unsavable in any respect the moment its first freelancer joined.
 */

/** A staffed engagement: three stages, the second of them priced and staffed. */
function lockState(over: Partial<LockState> = {}): LockState {
	return {
		format: "pipeline",
		structure: "standard",
		onboardedCount: 2,
		budgetAmountCents: null,
		priceById: new Map([["s1", 100_00], ["s2", 250_00], ["s3", null]]),
		lockedStageIds: new Set(["s2"]),
		...over,
	};
}

Deno.test("a payload that could not touch a frozen field is not even checked", () => {
	// The pre-test that keeps an ordinary title save at the one read it always cost.
	assertEquals(touchesLockableFields({ title: "Renamed" }), false);
	assertEquals(touchesLockableFields({ rules: { visibility: "public" } }), false);
	assertEquals(touchesLockableFields({ format: "one_off" }), true);
	assertEquals(touchesLockableFields({ structure: "single_stage" }), true);
	assertEquals(touchesLockableFields({ budget: { amountCents: 1 } }), true);
	assertEquals(
		touchesLockableFields({ stages: [{ id: "s1", unitPriceCents: 5 }] }),
		true,
	);
	// A stage edit that touches no price is not a price change.
	assertEquals(touchesLockableFields({ stages: [{ id: "s1", name: "Renamed" }] }), false);
});

Deno.test("the whole form re-sent unchanged is not a refusal", () => {
	// The case a presence-based guard gets wrong, and the one every single save on this surface hits.
	const refusal = onboardingLockRefusal({
		title: "Anything",
		format: "pipeline",
		structure: "standard",
		stages: [
			{ id: "s1", unitPriceCents: 100_00 },
			{ id: "s2", unitPriceCents: 250_00 },
			{ id: "s3", unitPriceCents: null },
		],
	}, lockState());
	assertEquals(refusal, null);
});

Deno.test("changing the project type on a staffed engagement is refused", () => {
	const refusal = onboardingLockRefusal({ format: "one_off" }, lockState());
	assert(refusal);
	assertEquals(refusal.status, 422);
	assertEquals(refusal.errors?.format, "field_locked_post_onboarding");
});

Deno.test("turning stages off on a staffed engagement is refused too", () => {
	// The half a guard on `format` alone would miss. The has-stages toggle writes `structure`, and
	// flipping it strands every provider hired onto stages 2..n — so a lock on the type alone is one
	// a caller could simply walk around.
	const refusal = onboardingLockRefusal({ structure: "single_stage" }, lockState());
	assert(refusal);
	assertEquals(refusal.status, 422);
	assertEquals(refusal.errors?.structure, "field_locked_post_onboarding");
});

Deno.test("an unstaffed engagement may still change shape freely", () => {
	const open = lockState({ onboardedCount: 0, lockedStageIds: new Set() });
	assertEquals(onboardingLockRefusal({ format: "one_off" }, open), null);
	assertEquals(onboardingLockRefusal({ structure: "single_stage" }, open), null);
});

Deno.test("only the STAFFED stage's price is refused", () => {
	// The rule that makes the lock usable at all: staffing one stage must not freeze the commercials
	// of every other stage in the run.
	const stored = lockState();
	assert(onboardingLockRefusal({ stages: [{ id: "s2", unitPriceCents: 999_00 }] }, stored));
	assertEquals(
		onboardingLockRefusal({ stages: [{ id: "s1", unitPriceCents: 999_00 }] }, stored),
		null,
	);
	assertEquals(
		onboardingLockRefusal({ stages: [{ id: "s3", unitPriceCents: 999_00 }] }, stored),
		null,
	);
});

Deno.test("a locked stage may still have everything BUT its price edited", () => {
	// The lock freezes one term, not the stage. Scope, tasks and skills stay the client's to correct —
	// and a freelancer working the stage benefits from a clarified brief.
	assertEquals(
		onboardingLockRefusal({
			stages: [{ id: "s2", name: "Renamed", milestone: "2 weeks", skills: ["Figma"] }],
		}, lockState()),
		null,
	);
});

Deno.test("a stage the project does not own is left to the reconciler to refuse", () => {
	// Not this guard's question, and answering it here would give the caller a lock message about a
	// stage that is not theirs instead of the sentence that names the real problem.
	assertEquals(
		onboardingLockRefusal({ stages: [{ id: "elsewhere", unitPriceCents: 1 }] }, lockState()),
		null,
	);
	// A stage with no id is a CREATE, and nobody can have been onboarded onto a row that does not
	// exist yet.
	assertEquals(onboardingLockRefusal({ stages: [{ unitPriceCents: 1 }] }, lockState()), null);
});

Deno.test("a role-staffed engagement refuses its project amount, not a stage", () => {
	const stored = lockState({
		format: "one_off",
		structure: "single_task",
		budgetAmountCents: 400_00,
		lockedStageIds: new Set(),
	});
	const refusal = onboardingLockRefusal({ budget: { amountCents: 900_00 } }, stored);
	assert(refusal);
	assertEquals(refusal.status, 422);
	assertEquals(refusal.errors?.budget, "field_locked_post_onboarding");
	// Re-sending the stored figure is not a change.
	assertEquals(onboardingLockRefusal({ budget: { amountCents: 400_00 } }, stored), null);
	// And a currency change is not a price change.
	assertEquals(onboardingLockRefusal({ budget: { currency: "EUR" } }, stored), null);
});

Deno.test("a STAGED engagement's project amount is never refused", () => {
	// It is derived from the stage fees by the roll-up, so refusing a client's copy of it would fail
	// the save that is about to overwrite that number anyway.
	assertEquals(
		onboardingLockRefusal({ budget: { amountCents: 900_00 } }, lockState()),
		null,
	);
});
// #endregion
