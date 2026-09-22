/**
 * The cross-check between the invitation rules stated here and the ones the database enforces.
 *
 * Two of this module's rules have a SQL twin, and a twin that lives in a string is drift a type-checker
 * cannot see:
 *
 *  - the re-invitation cooldown (`INVITE_COOLDOWN_DAYS`) is enforced by the fat service through
 *    `hireInvitationRefusal` AND by `projects.invite_to_project`, as `interval '48 days'`. If either
 *    side moves alone, a client is refused a day the interface said was open, or allowed one it said
 *    was locked;
 *  - the statuses the Zod enum renders (`InviteStatus`) and the CHECK on
 *    `projects.project_invitations.status` describe one column. The enum omits exactly `revoked` —
 *    the client's own withdrawal, which never renders — and the CHECK must not gain a value the
 *    reader cannot label, nor lose one the reader depends on.
 *
 * Deliberately a test over FILE CONTENT rather than a live query (the `nda.contract.test.ts` and
 * `slug.contract.test.ts` technique): it has to fail in CI and on a laptop with no database, at the
 * moment somebody edits one side and not the other.
 */
import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { INVITE_COOLDOWN_DAYS } from "./hire.ts";
import { InviteStatus } from "./members.ts";

const REPO = new URL("../../../", import.meta.url);
const read = (rel: string) => Deno.readTextFileSync(new URL(rel, REPO));

const TABLE_SQL = "supabase/migrations/00000015_tables_projects.sql";
const RPC_SQL = "supabase/migrations/00001130_functions_projects_stages.sql";

/** The body of one `CREATE OR REPLACE FUNCTION <name>` … `$$;` block. */
function functionBody(sql: string, name: string): string {
	const start = sql.indexOf(`CREATE OR REPLACE FUNCTION ${name}(`);
	assert(start >= 0, `${name} is no longer defined in ${RPC_SQL}`);
	const end = sql.indexOf("\n$$;", start);
	assert(end > start, `${name} has no terminating $$;`);
	return sql.slice(start, end);
}

// #region The cooldown has one value
Deno.test("invite_to_project enforces the SAME cooldown the TypeScript rule does", () => {
	const body = functionBody(read(RPC_SQL), "projects.invite_to_project");
	const intervals = [...body.matchAll(/interval '(\d+) days'/g)].map((m) => Number(m[1]));
	// 14 is the offer's expiry; the other figure is the cooldown, and it must be the SSOT's.
	const cooldowns = intervals.filter((days) => days !== 14);
	assertEquals(cooldowns, [INVITE_COOLDOWN_DAYS]);
});
// #endregion

// #region The status vocabulary is one column
Deno.test("the status CHECK is the Zod enum plus exactly `revoked`", () => {
	const sql = read(TABLE_SQL);
	const match = sql.match(/project_invitations_status_check CHECK \(status IN \(([^)]*)\)\)/);
	assert(match, "the status CHECK is gone or renamed");
	const db = match[1].split(",").map((v) => v.trim().replace(/^'|'$/g, "")).sort();
	const zod = [...InviteStatus.options, "revoked"].sort();
	assertEquals(db, zod);
});

Deno.test("dismissed_at exists and is barred from an open offer", () => {
	const sql = read(TABLE_SQL);
	assertStringIncludes(sql, "dismissed_at timestamp with time zone");
	assertStringIncludes(
		sql,
		"ck_project_invitations_dismissed CHECK (dismissed_at IS NULL OR status <> 'pending')",
	);
});
// #endregion

// #region The grants are what the module docblocks claim
Deno.test("fn_apply_invitation_decision has no client grant; the two doors do", () => {
	const sql = read(RPC_SQL);
	assertStringIncludes(
		sql,
		"GRANT EXECUTE ON FUNCTION projects.fn_apply_invitation_decision(uuid, boolean, uuid) TO service_role;",
	);
	assert(
		!/fn_apply_invitation_decision\(uuid, boolean, uuid\) TO authenticated/.test(sql),
		"the core decision function must not be reachable from PostgREST — it trusts p_actor",
	);
	assertStringIncludes(
		sql,
		"GRANT EXECUTE ON FUNCTION projects.respond_to_project_invitation(uuid, boolean) TO authenticated;",
	);
	assertStringIncludes(
		sql,
		"GRANT EXECUTE ON FUNCTION projects.invite_to_project(uuid, uuid, uuid, text, text, bigint, jsonb) TO authenticated;",
	);
});
// #endregion
