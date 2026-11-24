import { assert, assertEquals, assertFalse } from "@std/assert";
import {
	createFormatToColumns,
	isStaleSetupWrite,
	isStoredShapePair,
	ONBOARDED_ASSIGNMENT_EXCLUDED,
	ProjectFormat,
	ProjectStructure,
	StageAssignmentStatus,
} from "@projective/types/projects";
import { batchFieldOf, isBatchRef, WriteBatch } from "./write-batch.ts";

Deno.test("WriteBatch: kept ops hand out distinct references a later op can name", () => {
	const batch = new WriteBatch();
	const stage = batch.rpc("create_stage", { p_project_id: "p", p_name: "A" }, "stages", true);
	assert(isBatchRef(stage));
	batch.update("project_stages", stage!, { milestone: "M" }, "stages");
	batch.insert("stage_staffing_roles", { role_title: "R", project_stage_id: stage }, "stages");
	const second = batch.rpc("create_stage", { p_project_id: "p", p_name: "B" }, "stages", true);
	assert(second!.$ref !== stage!.$ref);
	assertEquals(batch.ops.length, 4);
	assertEquals(batch.ops[0], {
		kind: "rpc",
		fn: "create_stage",
		args: { p_project_id: "p", p_name: "A" },
		field: "stages",
		ref: stage!.$ref,
	});
	assertEquals((batch.ops[1] as { id: unknown }).id, stage);
});

Deno.test("WriteBatch: an op without keep stores nothing, and an empty batch says so", () => {
	const batch = new WriteBatch();
	assert(batch.empty);
	assertEquals(batch.insert("project_attachments", { project_id: "p", attachment_id: "f" }), null);
	assertEquals((batch.ops[0] as { ref?: string }).ref, undefined);
	assertFalse(batch.empty);
});

Deno.test("batchFieldOf reads the field the failing op named, and nothing else", () => {
	assertEquals(batchFieldOf("field:stages"), "stages");
	assertEquals(batchFieldOf("field:"), undefined);
	assertEquals(batchFieldOf("some other hint"), undefined);
	assertEquals(batchFieldOf(null), undefined);
});

Deno.test("every shape the create path writes is a pair ck_projects_format_structure accepts", () => {
	for (const format of ["one_off", "pipeline"] as const) {
		for (const stages of [true, false]) {
			const shape = createFormatToColumns(format, stages);
			assert(isStoredShapePair(shape.format, shape.structure), `${format}/${stages}`);
		}
	}
	assert(isStoredShapePair("session", "standard"));
	assertFalse(isStoredShapePair("pipeline", "one_off"));
	assertFalse(isStoredShapePair("pipeline", "single_task"));
	assertFalse(isStoredShapePair("one_off", "standard"));
	assertFalse(isStoredShapePair("session", "single_stage"));
	// Every enum member is covered by the table, so a new format cannot be silently unstorable.
	for (const format of ProjectFormat.options) {
		assert(ProjectStructure.options.some((s) => isStoredShapePair(format, s)));
	}
});

Deno.test("the onboarding deny-list is drawn from the seat vocabulary", () => {
	for (const status of ONBOARDED_ASSIGNMENT_EXCLUDED) {
		assert(StageAssignmentStatus.safeParse(status).success, status);
	}
});

Deno.test("WriteBatch: the version check runs first and alone writes nothing (ST1)", () => {
	const batch = new WriteBatch();
	batch.version("p-1", "2026-11-24T10:00:00.123Z", "form");
	assert(batch.empty, "a version check alone is never sent");
	batch.update("projects", "p-1", { title: "x" });
	batch.version("p-1", "2026-11-24T10:00:00.123Z", "form");
	assertFalse(batch.empty);
	assertEquals(batch.ops[0], {
		kind: "version",
		id: "p-1",
		expected: "2026-11-24T10:00:00.123Z",
		field: "form",
	});
});

Deno.test("isStaleSetupWrite compares to the millisecond, as the batch's version op does (ST1)", () => {
	// PostgREST writes microseconds; the client sends what it read, or the millisecond JSON keeps.
	assertFalse(isStaleSetupWrite("2026-11-24T10:00:00.123Z", "2026-11-24T10:00:00.123456+00:00"));
	assertFalse(isStaleSetupWrite("2026-11-24T11:00:00.123+01:00", "2026-11-24T10:00:00.123Z"));
	assert(isStaleSetupWrite("2026-11-24T10:00:00.123Z", "2026-11-24T10:00:00.124Z"));
	assert(isStaleSetupWrite("not a time", "2026-11-24T10:00:00.123Z"));
});
