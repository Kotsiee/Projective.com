/**
 * Project DMs against the SQL they mirror (PROJECTS CH3, Decision #560): the link table's columns and
 * CHECKs, the two definer doors and the internal rule they share, their grants by name (#477), the
 * participants-only read with no client write, and the notice the other person is told by. A test
 * over FILE CONTENT (the `hire.contract.test.ts` technique), so it fails with no database;
 * `room_read_marks.sql` §5 proves the behaviour on one.
 */
import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { DmThreadProjectRowSchema } from "./project-dms.ts";
import { KNOWN_NOTIFICATION_TYPES } from "../comms/catalog.ts";

const REPO = new URL("../../../", import.meta.url);
const read = (rel: string) => Deno.readTextFileSync(new URL(rel, REPO)).replace(/\r\n/g, "\n");

const TABLES = read("supabase/migrations/00000016_tables_comms.sql");
const FUNCTIONS = read("supabase/migrations/00001300_functions_comms_channels.sql");
const RLS = read("supabase/migrations/00002001_policies_enable_rls.sql");
const POLICIES = read("supabase/migrations/00002012_policies_comms.sql");
const CATALOG = read("supabase/migrations/00005010_seed_notification_catalog.sql");
const normal = (s: string) => s.replace(/\s+/g, " ").replace(/ \(/g, "(");
const FN_GRANTS = normal(read("supabase/migrations/00002510_permissions_function_grants.sql"));
const TABLE_GRANTS = normal(read("supabase/migrations/00002520_permissions_table_grants.sql"));

function tableBlock(name: string): string {
	const start = TABLES.indexOf(`CREATE TABLE ${name} (`);
	assert(start >= 0, `${name} is no longer defined`);
	return TABLES.slice(start, TABLES.indexOf("\n);", start) + 3);
}

function functionBlock(name: string): string {
	const start = FUNCTIONS.indexOf(`CREATE OR REPLACE FUNCTION ${name}(`);
	assert(start >= 0, `${name} is no longer defined`);
	const open = FUNCTIONS.indexOf("AS $$", start);
	return FUNCTIONS.slice(start, FUNCTIONS.indexOf("$$;", open + 5) + 3);
}

const camel = (s: string) => s.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());

Deno.test("DmThreadProjectRowSchema carries exactly comms.dm_thread_projects' columns and CHECKs", () => {
	const block = tableBlock("comms.dm_thread_projects");
	const columns = [...block.matchAll(/^\s{4}([a-z_]+) (uuid|timestamp)/gm)].map((m) => camel(m[1]));
	assertEquals(columns.sort(), Object.keys(DmThreadProjectRowSchema.shape).sort());
	assertStringIncludes(block, "PRIMARY KEY (thread_id, project_id)");
	assertStringIncludes(block, "CHECK ((brought_in_by IS NULL) = (brought_in_at IS NULL))");
	assertStringIncludes(block, "CHECK ((taken_out_by IS NULL) = (taken_out_at IS NULL))");
	assertStringIncludes(block, "CHECK (brought_in_at IS NOT NULL OR taken_out_at IS NOT NULL)");
	const at = "2026-11-24T00:00:00Z";
	const id = "00000000-0000-4000-8000-000000000001";
	const row = {
		threadId: id,
		projectId: id,
		broughtInBy: null,
		broughtInAt: null,
		takenOutBy: null,
		takenOutAt: null,
	};
	assertEquals(DmThreadProjectRowSchema.safeParse(row).success, false, "a row says something");
	assertEquals(
		DmThreadProjectRowSchema.safeParse({ ...row, broughtInAt: at }).success,
		false,
		"who and when together",
	);
	assert(DmThreadProjectRowSchema.safeParse({ ...row, takenOutBy: id, takenOutAt: at }).success);
});

Deno.test("the two doors are definers on an empty search_path; the rule they share is never granted", () => {
	for (
		const name of [
			"comms.bring_dm_into_project",
			"comms.take_dm_out_of_project",
			"comms.fn_dm_in_project",
		]
	) {
		const block = functionBlock(name);
		assertStringIncludes(block, "SECURITY DEFINER", name);
		assertStringIncludes(block, "SET search_path = ''", name);
	}
	const bring = functionBlock("comms.bring_dm_into_project");
	// The pair's thread comes from the DM opener, so its every rule (lock, shield, no self-DM) holds.
	assertStringIncludes(bring, "comms.get_or_create_dm_thread(p_target_user_id)");
	// Both people must be parties; the other is told once, at the project address of the conversation.
	assertStringIncludes(bring, "projects.fn_engaged_projects(v_me)");
	assertStringIncludes(bring, "projects.fn_engaged_projects(p_target_user_id)");
	assertStringIncludes(bring, "'message.brought_into_project'");
	assertStringIncludes(bring, "'/projects/' || v_project.slug || '/' || v_ref");
	// A take-out never touches a stamp.
	assert(!/UPDATE comms\.dm_messages/.test(functionBlock("comms.take_dm_out_of_project")));
	for (
		const fn of [
			"comms.bring_dm_into_project(uuid, uuid)",
			"comms.take_dm_out_of_project(uuid, uuid)",
		]
	) {
		assertStringIncludes(FN_GRANTS, `REVOKE ALL ON FUNCTION ${fn} FROM public, anon;`);
		assertStringIncludes(FN_GRANTS, `GRANT EXECUTE ON FUNCTION ${fn} TO authenticated;`);
	}
	assertStringIncludes(
		FN_GRANTS,
		"REVOKE ALL ON FUNCTION comms.fn_dm_in_project(uuid, uuid) FROM public, anon, authenticated;",
	);
	assert(!/GRANT [^;]*comms\.fn_dm_in_project\(/.test(FN_GRANTS), "the shared rule is internal");
});

Deno.test("the link is RLS-on, read by the thread's participants, and takes no client write", () => {
	assertStringIncludes(RLS, "ALTER TABLE comms.dm_thread_projects ENABLE ROW LEVEL SECURITY;");
	const policies = [
		...POLICIES.matchAll(/CREATE POLICY "[^"]+" ON comms\.dm_thread_projects FOR\s+(\w+)[^;]*;/g),
	];
	assertEquals(policies.map((m) => m[1]), ["SELECT"]);
	assertStringIncludes(policies[0][0], "comms.is_dm_participant (thread_id)");
	assertStringIncludes(
		TABLE_GRANTS,
		"REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE comms.dm_thread_projects FROM authenticated;",
	);
});

Deno.test("the other person's notice is catalogued in SQL and in TS", () => {
	assert((KNOWN_NOTIFICATION_TYPES as readonly string[]).includes("message.brought_into_project"));
	const row = CATALOG.split("\n").find((l) => l.startsWith("('message.brought_into_project'"));
	assert(row, "00005010 catalogues message.brought_into_project");
	assertStringIncludes(row, "'messages'");
	assertStringIncludes(row, "ARRAY['in_app']");
});
