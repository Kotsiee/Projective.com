/**
 * The cross-check between the reschedule rules stated here and the ones the database enforces.
 *
 * {@link RESCHEDULE_PROPOSALS_MAX} is enforced in three places: the Zod `proposals` array, the
 * planner's `ballot_full` refusal, and `scheduling.fn_cap_reschedule_proposals` — a trigger whose
 * figure lives in a string, where a type-checker cannot see it drift. If the SQL cap is raised alone,
 * a round holds slots the schema refuses to parse; if it is lowered alone, a slot the planner allowed
 * is refused as an unexplained failure.
 *
 * Deliberately a test over FILE CONTENT rather than a live query (the `hire.contract.test.ts` and
 * `slug.contract.test.ts` technique): it has to fail in CI and on a laptop with no database, at the
 * moment somebody edits one side and not the other.
 */
import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { EventRescheduleSchema, RESCHEDULE_PROPOSALS_MAX } from "./coordination.ts";

const REPO = new URL("../../../", import.meta.url);
const read = (rel: string) => Deno.readTextFileSync(new URL(rel, REPO));

const FN_SQL = "supabase/migrations/00001510_functions_scheduling.sql";
const TRIGGER_SQL = "supabase/migrations/00001860_triggers_scheduling.sql";

/** The body of one `CREATE OR REPLACE FUNCTION <name>()` … `$$;` block. */
function functionBody(sql: string, name: string): string {
	const start = sql.indexOf(`CREATE OR REPLACE FUNCTION ${name}(`);
	assert(start >= 0, `${name} is no longer defined in ${FN_SQL}`);
	const end = sql.indexOf("\n$$;", start);
	assert(end > start, `${name} has no terminating $$;`);
	return sql.slice(start, end);
}

Deno.test("the ballot-cap trigger refuses at the SAME count the TypeScript rule does", () => {
	const body = functionBody(read(FN_SQL), "scheduling.fn_cap_reschedule_proposals");
	const caps = [...body.matchAll(/v_count\s*>=\s*(\d+)/g)].map((m) => Number(m[1]));
	assertEquals(caps, [RESCHEDULE_PROPOSALS_MAX]);
	// The count is only race-free under a lock on the round it is counting.
	assertStringIncludes(body, "FROM scheduling.event_reschedules WHERE id = NEW.reschedule_id FOR UPDATE");
	// A refusal the write path can map to `ballot_full` rather than to a generic failure.
	assertStringIncludes(body, "ERRCODE = 'check_violation'");
});

Deno.test("the trigger is attached BEFORE INSERT on reschedule_proposals", () => {
	const sql = read(TRIGGER_SQL).replace(/\s+/g, " ");
	assertStringIncludes(
		sql,
		"CREATE OR REPLACE TRIGGER trg_cap_reschedule_proposals BEFORE INSERT ON scheduling.reschedule_proposals FOR EACH ROW EXECUTE FUNCTION scheduling.fn_cap_reschedule_proposals ();",
	);
});

Deno.test("the schema parses a full round and refuses one slot more", () => {
	const slot = (i: number) => ({
		id: `p${i}`,
		start: i * 3_600_000,
		end: i * 3_600_000 + 1_800_000,
		proposedBy: { name: "Host", avatar: null, handle: null },
		proposedByRole: "host" as const,
		proposedAt: 0,
		approved: true,
		note: null,
	});
	const round = (n: number) => ({
		mode: "vote" as const,
		status: "collecting" as const,
		openedBy: null,
		openedAt: 0,
		proposals: Array.from({ length: n }, (_, i) => slot(i)),
		resolvesAt: null,
		resolvedProposalId: null,
	});
	assert(EventRescheduleSchema.safeParse(round(RESCHEDULE_PROPOSALS_MAX)).success);
	assert(!EventRescheduleSchema.safeParse(round(RESCHEDULE_PROPOSALS_MAX + 1)).success);
});
