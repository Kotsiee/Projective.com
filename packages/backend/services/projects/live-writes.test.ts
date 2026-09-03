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
import { planAttachments, planStageRoles, stageTermsPatch } from "./live-writes.ts";

/** A stored role id, in the shape the column actually holds. */
function storedId(): string {
	return crypto.randomUUID();
}

/** A submitted role, priced unless told otherwise. */
function role(id: string, overrides: Partial<StageStaffingRole> = {}): StageStaffingRole {
	return {
		id,
		name: "Illustrator",
		quantity: 1,
		budgetCents: 120_000,
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

Deno.test("an UNPRICED role is expressible in the SSOT and not in the column", () => {
	// The reason `reconcileStageRoles` refuses one rather than writing zero. If this ever stops
	// parsing — because `budgetCents` was made non-nullable — the refusal becomes dead code and this
	// assertion is what says so, instead of the branch quietly never firing again.
	const parsed = StageStaffingRoleSchema.safeParse(role("role-draft-1", { budgetCents: null }));
	assert(
		parsed.success,
		"StageStaffingRoleSchema no longer accepts a null budget, so `unpricedStageRole` is unreachable",
	);
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
		dependency: "parallel",
		durationDays: 5,
		allowedFileKinds: ["image", "pdf"],
		ndaRequired: true,
		capacity: "limited",
		seatCount: 3,
	});

	assertEquals(patch.default_tasks, [{ id: "t1", text: "Wireframes" }]);
	assertEquals(patch.skills, ["Figma", "Copywriting"]);
	assertEquals(patch.milestone, "Concepts signed off");
	assertEquals(patch.file_duration_days, 5);
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
