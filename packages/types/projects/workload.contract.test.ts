/**
 * The workload gauge against the SQL it mirrors (PROJECTS ST4): the self-reader's shape and grants,
 * the jsonb keys `WorkloadCapacityRowSchema` parses, and `check_ticket_capacity`'s refusal sentences,
 * which the copy beside Claim repeats word for word. A test over FILE CONTENT (the
 * `hire.contract.test.ts` technique), so it fails with no database.
 */
import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import {
	claimCapacityVerdict,
	formatIntensity,
	globalCapReason,
	stageCapReason,
	WorkloadCapacityRowSchema,
	workloadLevel,
} from "./workload.ts";

const REPO = new URL("../../../", import.meta.url);
const read = (rel: string) => Deno.readTextFileSync(new URL(rel, REPO));

const WORKLOAD_SQL = read(
	"supabase/migrations/00001140_functions_projects_automation_workload.sql",
);
// Whitespace-normalised: the SQL formatter reflows a grant and spaces the argument list off the name.
const GRANTS = read("supabase/migrations/00002510_permissions_function_grants.sql")
	.replace(/\s+/g, " ").replace(/ \(/g, "(");

/** The body of one `CREATE OR REPLACE FUNCTION <name>(` … `$$ LANGUAGE …;` block. */
function functionBlock(sql: string, name: string): string {
	const start = sql.indexOf(`CREATE OR REPLACE FUNCTION ${name}(`);
	assert(start >= 0, `${name} is no longer defined`);
	const close = sql.indexOf("$$ LANGUAGE", start + 1);
	assert(close > start, `${name} has no closing $$ LANGUAGE`);
	return sql.slice(start, sql.indexOf(";", close) + 1);
}

/** `check_ticket_capacity`'s format() strings, in order. */
function refusalFormats(): string[] {
	const body = functionBlock(WORKLOAD_SQL, "projects.check_ticket_capacity");
	return [...body.matchAll(/format\(\s*'([^']+)'/g)].map((m) => m[1]);
}

/** A format() string with each `%s` filled in turn. */
function fill(format: string, values: string[]): string {
	let i = 0;
	return format.replace(/%s/g, () => values[i++]);
}

Deno.test("the self-reader takes no argument, passes auth.uid() and pins an empty search_path", () => {
	const block = functionBlock(WORKLOAD_SQL, "projects.get_my_workload_capacity");
	assertStringIncludes(block, "projects.get_my_workload_capacity()");
	assertStringIncludes(block, "projects.get_workload_capacity(auth.uid(), NULL)");
	assertStringIncludes(block, "t.current_assignee_id = auth.uid()");
	assertStringIncludes(block, "SECURITY DEFINER");
	assertStringIncludes(block, "SET search_path = ''");
});

Deno.test("only the self-reader is a client door; the any-user reader stays ungranted", () => {
	assertStringIncludes(
		GRANTS,
		"GRANT EXECUTE ON FUNCTION projects.get_my_workload_capacity() TO authenticated;",
	);
	assertStringIncludes(
		GRANTS,
		"REVOKE ALL ON FUNCTION projects.get_my_workload_capacity() FROM PUBLIC, anon;",
	);
	assertStringIncludes(
		GRANTS,
		"REVOKE ALL ON FUNCTION projects.get_workload_capacity(uuid, uuid) FROM PUBLIC, anon, authenticated;",
	);
	assert(
		!/GRANT [^;]*projects\.get_workload_capacity\(/.test(GRANTS),
		"projects.get_workload_capacity must never be granted: it answers for any user",
	);
});

Deno.test("WorkloadCapacityRowSchema parses exactly the keys the self-reader answers", () => {
	const block = functionBlock(WORKLOAD_SQL, "projects.get_workload_capacity");
	const built = block.slice(block.indexOf("jsonb_build_object("));
	const keys = [...built.matchAll(/'([a-z_]+)',/g)].map((m) => m[1]);
	const self = functionBlock(WORKLOAD_SQL, "projects.get_my_workload_capacity");
	assertStringIncludes(self, "jsonb_build_object('stages',");
	assertStringIncludes(self, "jsonb_build_object('stage_id', s.stage_id, 'current', s.current)");
	assertEquals([...keys, "stages"].sort(), Object.keys(WorkloadCapacityRowSchema.shape).sort());
});

Deno.test("the refusal copy repeats check_ticket_capacity's sentences word for word", () => {
	const [global, stage, ...rest] = refusalFormats();
	assertEquals(rest, [], "check_ticket_capacity grew a third refusal sentence");
	assertEquals(globalCapReason(1.5, 5.5, 5), fill(global, ["1.5", "5.5", "5"]));
	assertEquals(stageCapReason(0.75, 2.25, 2), fill(stage, ["0.75", "2.25", "2"]));
});

Deno.test("formatIntensity prints what trim_scale prints for numeric(6,2)", () => {
	assertEquals(formatIntensity(2), "2");
	assertEquals(formatIntensity(2.5), "2.5");
	assertEquals(formatIntensity(0.75), "0.75");
	assertEquals(formatIntensity(10), "10");
});

Deno.test("workloadLevel: room, under one standard ticket of room, none", () => {
	assertEquals(workloadLevel({ current: 2, cap: 5 }), "normal");
	assertEquals(workloadLevel({ current: 4, cap: 5 }), "normal");
	assertEquals(workloadLevel({ current: 4.5, cap: 5 }), "near");
	assertEquals(workloadLevel({ current: 5, cap: 5 }), "at");
	assertEquals(workloadLevel({ current: 6, cap: 5 }), "at");
});

Deno.test("claimCapacityVerdict checks the global cap first, then the stage's, as the door does", () => {
	const fits = claimCapacityVerdict({ current: 2, cap: 5 }, 3);
	assertEquals([fits.allowed, fits.scope, fits.reason, fits.globalProjected], [
		true,
		null,
		null,
		5,
	]);

	const global = claimCapacityVerdict({ current: 4.5, cap: 5 }, 1, { current: 3, cap: 2 });
	assertEquals([global.allowed, global.scope], [false, "global"]);
	assertEquals(global.reason, globalCapReason(1, 5.5, 5));

	const stage = claimCapacityVerdict({ current: 1, cap: 5 }, 1, { current: 1.5, cap: 2 });
	assertEquals([stage.allowed, stage.scope], [false, "stage"]);
	assertEquals(stage.reason, stageCapReason(1, 2.5, 2));

	const unlimited = claimCapacityVerdict({ current: 1, cap: 5 }, 1, { current: 9, cap: null });
	assertEquals(unlimited.allowed, true);
});
