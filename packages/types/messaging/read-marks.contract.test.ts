/**
 * Read marks against the SQL they mirror (PROJECTS CH3; PRD-E13, PRD-E17): the room read table's
 * columns, the one definer that writes it, the two invoker reads, their grants by name (#477), and
 * the table's own-row-only read with no client write. A test over FILE CONTENT (the
 * `hire.contract.test.ts` technique), so it fails with no database; `room_read_marks.sql` proves the
 * behaviour on one.
 */
import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { ProjectChannelReadRowSchema } from "./read-marks.ts";

const REPO = new URL("../../../", import.meta.url);
const read = (rel: string) => Deno.readTextFileSync(new URL(rel, REPO)).replace(/\r\n/g, "\n");

const TABLES = read("supabase/migrations/00000016_tables_comms.sql");
const FUNCTIONS = read("supabase/migrations/00001300_functions_comms_channels.sql");
const RLS = read("supabase/migrations/00002001_policies_enable_rls.sql");
const POLICIES = read("supabase/migrations/00002012_policies_comms.sql");
// Whitespace-normalised: the SQL formatter reflows a grant and spaces the argument list off the name.
const normal = (s: string) => s.replace(/\s+/g, " ").replace(/ \(/g, "(");
const FN_GRANTS = normal(read("supabase/migrations/00002510_permissions_function_grants.sql"));
const TABLE_GRANTS = normal(read("supabase/migrations/00002520_permissions_table_grants.sql"));

/** The body of one `CREATE TABLE <name> (` … `);` block. */
function tableBlock(name: string): string {
	const start = TABLES.indexOf(`CREATE TABLE ${name} (`);
	assert(start >= 0, `${name} is no longer defined`);
	return TABLES.slice(start, TABLES.indexOf("\n);", start) + 3);
}

/** The body of one `CREATE OR REPLACE FUNCTION <name>(` … closing `$$;` block. */
function functionBlock(name: string): string {
	const start = FUNCTIONS.indexOf(`CREATE OR REPLACE FUNCTION ${name}(`);
	assert(start >= 0, `${name} is no longer defined`);
	const open = FUNCTIONS.indexOf("AS $$", start);
	const close = FUNCTIONS.indexOf("$$;", open + 5);
	return FUNCTIONS.slice(start, close + 3);
}

/** snake_case → camelCase, the mapper's own rule. */
const camel = (s: string) => s.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());

Deno.test("ProjectChannelReadRowSchema carries exactly comms.project_channel_reads' columns", () => {
	const block = tableBlock("comms.project_channel_reads");
	const columns = [...block.matchAll(/^\s{4}([a-z_]+) (uuid|timestamp)/gm)].map((m) => camel(m[1]));
	assertEquals(columns.sort(), Object.keys(ProjectChannelReadRowSchema.shape).sort());
	assertStringIncludes(block, "PRIMARY KEY (channel_id, user_id)");
	assertStringIncludes(block, "REFERENCES comms.project_channels (id)");
});

Deno.test("mark_room_read is the one writer: a definer on an empty search_path that checks room access", () => {
	const block = functionBlock("comms.mark_room_read");
	assertStringIncludes(block, "SECURITY DEFINER");
	assertStringIncludes(block, "SET search_path = ''");
	assertStringIncludes(block, "comms.has_channel_access(p_channel_id)");
	assertStringIncludes(block, "USING ERRCODE = '42501'");
	// It writes only the caller's own row.
	assertStringIncludes(block, "VALUES (p_channel_id, v_me, pg_catalog.now())");
});

Deno.test("the two reads are invokers on an empty search_path, so RLS decides what they answer", () => {
	for (const name of ["comms.unread_rooms", "comms.project_dm_threads"]) {
		const block = functionBlock(name);
		assertStringIncludes(block, "SECURITY INVOKER", name);
		assertStringIncludes(block, "SET search_path = ''", name);
	}
	// The never-opened baseline is the lane's own (00001145), not the room's whole history.
	assertStringIncludes(functionBlock("comms.unread_rooms"), "FROM projects.view_reads v");
});

Deno.test("each function is granted by name to authenticated only", () => {
	for (
		const fn of [
			"comms.mark_room_read(uuid)",
			"comms.unread_rooms(uuid)",
			"comms.project_dm_threads(uuid)",
		]
	) {
		assertStringIncludes(FN_GRANTS, `REVOKE ALL ON FUNCTION ${fn} FROM public, anon;`);
		assertStringIncludes(FN_GRANTS, `GRANT EXECUTE ON FUNCTION ${fn} TO authenticated;`);
	}
});

Deno.test("the read table is RLS-on, readable as one's own row only, and takes no client write", () => {
	assertStringIncludes(RLS, "ALTER TABLE comms.project_channel_reads ENABLE ROW LEVEL SECURITY;");
	const policies = [
		...POLICIES.matchAll(
			/CREATE POLICY "[^"]+" ON comms\.project_channel_reads FOR\s+(\w+)[^;]*;/g,
		),
	];
	assertEquals(policies.map((m) => m[1]), ["SELECT"]);
	assertStringIncludes(policies[0][0], "USING (user_id = auth.uid ())");
	assertStringIncludes(
		TABLE_GRANTS,
		"REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE comms.project_channel_reads FROM authenticated;",
	);
});
