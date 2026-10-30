/**
 * The delivery row schemas against the tables that store them (PROJECT_MANAGEMENT_COMPLETENESS audit
 * §5.5): `project_stages`, `tickets`, `stage_assignments` and `stage_submissions`, plus the enum and
 * CHECK vocabularies they speak. A column with no Zod key, a Zod key with no column, or a vocabulary
 * that falls out of step fails here the moment either side is edited.
 */
import { assert, assertEquals } from "@std/assert";
import type { z } from "zod";
import { columnDrift, readRepoFile, tableColumns } from "../core/table-contract.ts";
import { TicketStatus } from "./board.ts";
import {
	ProjectStageRowSchema,
	StageAssigneeType,
	StageAssignmentRowSchema,
	StageFileDurationMode,
	StageStartTrigger,
	StageStatus,
	StageSubmissionRowSchema,
	StoredSubmissionStatus,
	TicketPaymentStatus,
	TicketRowSchema,
} from "./rows.ts";
import { ProjectStatus } from "./summary.ts";

const ENUMS_SQL = readRepoFile("supabase/migrations/00000003_enums_core.sql");
const TABLES_SQL = readRepoFile("supabase/migrations/00000015_tables_projects.sql");

const ROWS: readonly [table: string, schema: z.ZodObject][] = [
	["projects.project_stages", ProjectStageRowSchema],
	["projects.tickets", TicketRowSchema],
	["projects.stage_assignments", StageAssignmentRowSchema],
	["projects.stage_submissions", StageSubmissionRowSchema],
];

for (const [table, schema] of ROWS) {
	Deno.test(`${table} ⇄ its row schema: zero drift`, () => {
		const drift = columnDrift(tableColumns(TABLES_SQL, table), Object.keys(schema.shape));
		assertEquals(drift, { missingKeys: [], extraKeys: [], staleAllowlist: [] });
	});
}

/** The quoted literals of the first `(...)` list after `anchor` in `sql`. */
function literalsAfter(sql: string, anchor: string): string[] {
	const at = sql.indexOf(anchor);
	assert(at >= 0, `anchor not found: ${anchor}`);
	const open = sql.indexOf("(", at + anchor.length - 1);
	return [...sql.slice(open + 1, sql.indexOf(")", open)).matchAll(/'([^']*)'/g)].map((m) => m[1]);
}

Deno.test("the delivery enums are the Postgres enum types, member for member, in order", () => {
	const enumOf = (name: string) => literalsAfter(ENUMS_SQL, `CREATE TYPE ${name} AS ENUM (`);
	assertEquals(enumOf("project_status"), [...ProjectStatus.options]);
	assertEquals(enumOf("stage_status"), [...StageStatus.options]);
	assertEquals(enumOf("ticket_status"), [...TicketStatus.options]);
	assertEquals(enumOf("payment_status"), [...TicketPaymentStatus.options]);
	assertEquals(enumOf("assignment_type"), [...StageAssigneeType.options]);
	assertEquals(enumOf("public.start_trigger_type"), [...StageStartTrigger.options]);
});

Deno.test("the delivery CHECK vocabularies are the Zod enums", () => {
	assertEquals(
		literalsAfter(TABLES_SQL, "CONSTRAINT stage_submissions_status_check CHECK (status IN ("),
		[
			...StoredSubmissionStatus.options,
		],
	);
	assertEquals(literalsAfter(TABLES_SQL, "file_duration_mode IN ("), [
		...StageFileDurationMode.options,
	]);
});

Deno.test("a stage's capacity and seat count agree", () => {
	const shape = ProjectStageRowSchema.shape;
	assertEquals(shape.capacity.options, ["unlimited", "limited"]);
	assertEquals(shape.seatCount.unwrap().safeParse(100).success, false);
});

Deno.test("a stored workload intensity is strictly positive and fits numeric(4,2)", () => {
	const wi = TicketRowSchema.shape.workloadIntensity;
	assertEquals([0.5, 1, 99.99].map((v) => wi.safeParse(v).success), [true, true, true]);
	assertEquals([0, -1, 100].map((v) => wi.safeParse(v).success), [false, false, false]);
});

const SEAT_CHECK = "CONSTRAINT ck_stage_assignments_status CHECK (status IN (";
Deno.test({
	name: "stage_assignments.status speaks StageAssignmentStatus (ck_stage_assignments_status)",
	// The CHECK lands with the projects integrity work (audit X8); until then the column is free text.
	ignore: !TABLES_SQL.includes(SEAT_CHECK),
	fn() {
		assertEquals(literalsAfter(TABLES_SQL, SEAT_CHECK), [
			...StageAssignmentRowSchema.shape.status.options,
		]);
	},
});
