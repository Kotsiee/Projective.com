/**
 * The contract between the prepaid-stage reader and door (Decision #556) and the Zod shapes the
 * backend parses them with. A test over FILE CONTENT (the `hire.contract.test.ts` technique), so it
 * fails with no database: the reader answers ids only (`PrepaidStageRowSchema`'s keys, never an amount),
 * both are pinned-path definers that check their own authority, the door refunds only through the
 * finance primitive, and both are granted to signed-in callers by name and never to `anon`.
 */
import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { PrepaidStageRowSchema } from "./ticket-funding.ts";

const REPO = new URL("../../../", import.meta.url);
const read = (rel: string) => Deno.readTextFileSync(new URL(rel, REPO)).replace(/\r\n/g, "\n");

const LIFECYCLE_SQL = "supabase/migrations/00001120_functions_projects_ticket_lifecycle.sql";
const FUNDING_SQL = "supabase/migrations/00001150_functions_projects_stage_funding_submissions.sql";
const GRANTS_SQL = "supabase/migrations/00002510_permissions_function_grants.sql";

/** The text of one `CREATE OR REPLACE FUNCTION <name>(` … `$$;` block. */
function functionBody(sql: string, name: string): string {
	const start = sql.indexOf(`CREATE OR REPLACE FUNCTION ${name}(`);
	assert(start >= 0, `${name} is no longer defined`);
	const end = sql.indexOf("\n$$;", start);
	assert(end > start, `${name} has no terminating $$;`);
	return sql.slice(start, end);
}

const reader = functionBody(read(LIFECYCLE_SQL), "projects.get_project_prepaid_stages");
const door = functionBody(read(FUNDING_SQL), "projects.refund_ticket_stage_reservation");
const grants = read(GRANTS_SQL).replace(/\s+/g, " ");

Deno.test("the prepaid-stage reader answers exactly the Zod row's keys: ids, never an amount", () => {
	const table = /RETURNS TABLE \(([^)]*)\)/.exec(reader);
	assert(table, "get_project_prepaid_stages no longer returns a table");
	const columns = table[1].split(",").map((c) => c.trim().split(/\s+/)[0]);
	assertEquals(columns, Object.keys(PrepaidStageRowSchema.shape));
	assertStringIncludes(reader, "e.status = 'reserved'");
	assert(!/amount|payer|wallet/i.test(table[1]), "the reader answers more than which stages");
});

Deno.test("the reader and the door are pinned-path definers that check their own authority", () => {
	for (const body of [reader, door]) {
		assertStringIncludes(body, "SECURITY DEFINER");
		assertStringIncludes(body, "SET search_path = ''");
	}
	assertStringIncludes(reader, "projects.has_project_access(p_project_id)");
	assertStringIncludes(door, "projects.fn_can_fund_project(v_project)");
	assertStringIncludes(door, "FOR UPDATE");
	assertStringIncludes(door, "ERRCODE = 'PF409'");
});

Deno.test("the door moves money only through the finance primitive, never a direct escrow write", () => {
	assertStringIncludes(
		door,
		"finance.fn_refund_ticket_reservations(p_ticket_id, p_stage_id, 'refunded_by_payer')",
	);
	assert(
		!/UPDATE\s+finance\.(escrows|wallets)/i.test(door),
		"the door writes finance.escrows or wallets directly",
	);
});

Deno.test("both are granted to signed-in callers by name, never to anon", () => {
	for (
		const fn of [
			"projects.get_project_prepaid_stages (uuid)",
			"projects.refund_ticket_stage_reservation (uuid, uuid)",
		]
	) {
		assertStringIncludes(grants, `REVOKE ALL ON FUNCTION ${fn} FROM PUBLIC, anon;`);
		assertStringIncludes(grants, `GRANT EXECUTE ON FUNCTION ${fn} TO authenticated;`);
		assert(!grants.includes(`GRANT EXECUTE ON FUNCTION ${fn} TO anon`), `${fn} is granted to anon`);
	}
});
