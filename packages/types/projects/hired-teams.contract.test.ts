/**
 * The cross-check between `projects.get_viewer_hired_teams` — which decides whether the Project Details
 * lane draws a Teams group — and `comms.can_access_scope`, which decides whether the viewer may enter
 * the talent room that group links to.
 *
 * Both answer "is this caller on a team holding a live assignment on this stage", and the answer lives
 * in two SQL strings a type-checker cannot compare. If one side's idea of "live" moves alone, a team
 * member either sees a group whose room refuses them or is refused a group for a room they can open.
 *
 * A test over FILE CONTENT (the `hire.contract.test.ts` technique), so it fails with no database.
 */
import { assert, assertEquals, assertStringIncludes } from "@std/assert";

const REPO = new URL("../../../", import.meta.url);
const read = (rel: string) => Deno.readTextFileSync(new URL(rel, REPO));

const PREDICATE_SQL = "supabase/migrations/00001100_functions_projects_read_access.sql";
const GATE_SQL = "supabase/migrations/00001300_functions_comms_channels.sql";
const GRANTS_SQL = "supabase/migrations/00002510_permissions_function_grants.sql";

/** The body of one `CREATE OR REPLACE FUNCTION <name>` … `$$;` block. */
function functionBody(sql: string, name: string): string {
	const start = sql.indexOf(`CREATE OR REPLACE FUNCTION ${name}(`);
	assert(start >= 0, `${name} is no longer defined`);
	const end = sql.indexOf("\n$$;", start);
	assert(end > start, `${name} has no terminating $$;`);
	return sql.slice(start, end);
}

/** Every `status NOT IN (...)` list in a body, each as a sorted set of its literals. */
function deadStatusLists(body: string): string[][] {
	return [...body.matchAll(/status NOT IN \(([^)]*)\)/g)].map((m) =>
		[...m[1].matchAll(/'([^']+)'/g)].map((l) => l[1]).sort()
	);
}

const predicate = functionBody(read(PREDICATE_SQL), "projects.get_viewer_hired_teams");
const gate = functionBody(read(GATE_SQL), "comms.can_access_scope");

Deno.test("the Teams predicate and the talent-room gate agree on what a live assignment is", () => {
	const gateLists = deadStatusLists(gate);
	assert(gateLists.length > 0, "can_access_scope no longer excludes any assignment status");
	const [predicateList, ...rest] = deadStatusLists(predicate);
	assertEquals(rest, [], "get_viewer_hired_teams grew a second status filter");
	for (const list of gateLists) assertEquals(predicateList, list);
});

Deno.test("the Teams predicate requires the same active team membership the gate does", () => {
	for (const body of [predicate, gate]) {
		assertStringIncludes(body, "assignee_type = 'team'");
		assertStringIncludes(body, "tm.user_id = auth.uid()");
		assertStringIncludes(body, "tm.status = 'active'");
	}
});

Deno.test("the Teams predicate is a pinned-path definer reachable by signed-in callers only", () => {
	assertStringIncludes(predicate, "SECURITY DEFINER");
	assertStringIncludes(predicate, "SET search_path = ''");
	const grants = read(GRANTS_SQL);
	assertStringIncludes(
		grants,
		"REVOKE ALL ON FUNCTION projects.get_viewer_hired_teams(uuid) FROM public, anon;",
	);
	assertStringIncludes(
		grants,
		"GRANT EXECUTE ON FUNCTION projects.get_viewer_hired_teams(uuid) TO authenticated;",
	);
});
