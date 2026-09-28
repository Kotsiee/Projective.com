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
import {
	EventRescheduleSchema,
	RESCHEDULE_LOCKOUT_HOURS,
	RESCHEDULE_PROPOSALS_MAX,
	VOTE_RESOLUTION_LEAD_HOURS,
} from "./coordination.ts";

const REPO = new URL("../../../", import.meta.url);
/** File text with line endings normalised, so an assertion never depends on how git checked it out. */
const read = (rel: string) => Deno.readTextFileSync(new URL(rel, REPO)).replace(/\r\n/g, "\n");

const FN_SQL = "supabase/migrations/00001510_functions_scheduling.sql";
const TRIGGER_SQL = "supabase/migrations/00001860_triggers_scheduling.sql";
const WRITER_TS = "packages/backend/services/scheduling/live-coordination-writes.ts";
const SEED_TS = "supabase/seeds/gen/emit-scheduling.ts";

/** The body of one `CREATE OR REPLACE FUNCTION <name>()` … `$$;` block (either spacing before `(`). */
function functionBody(sql: string, name: string): string {
	const head = `CREATE OR REPLACE FUNCTION ${name}`;
	const tight = sql.indexOf(`${head}(`);
	const start = tight >= 0 ? tight : sql.indexOf(`${head} (`);
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
	assertStringIncludes(
		body,
		"FROM scheduling.event_reschedules WHERE id = NEW.reschedule_id FOR UPDATE",
	);
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

Deno.test("the SQL vote deadline is the TypeScript one: lead before the earliest slot, capped at the lockout", () => {
	const body = functionBody(read(FN_SQL), "scheduling.fn_vote_deadline");
	const lead = [...body.matchAll(/earliest - interval '(\d+) hours'/g)].map((m) => Number(m[1]));
	const lockout = [...body.matchAll(/starts_at - interval '(\d+) hours'/g)].map((m) =>
		Number(m[1])
	);
	assertEquals(lead, [VOTE_RESOLUTION_LEAD_HOURS]);
	assertEquals(lockout, [RESCHEDULE_LOCKOUT_HOURS]);
	// LEAST, not the lead alone: without the cap a vote on later slots outlives the meeting it moves.
	assertStringIncludes(body, "LEAST(b.earliest - interval");
	// Only the BALLOT sets it — `isProposalOnBallot`.
	assertStringIncludes(body, "(p.proposed_by_role = 'host' OR p.approved)");
});

Deno.test("the seed stamps a vote deadline by the same rule and the same constants", () => {
	const seed = read(SEED_TS);
	assertStringIncludes(seed, "interval '${VOTE_RESOLUTION_LEAD_HOURS} hours'");
	assertStringIncludes(seed, "interval '${RESCHEDULE_LOCKOUT_HOURS} hours'");
	assertStringIncludes(seed, "LEAST(");
});

Deno.test("the write guard refuses a closed round under the round's lock, with the code the writer maps", () => {
	const body = functionBody(read(FN_SQL), "scheduling.fn_guard_reschedule_write");
	assertStringIncludes(body, "WHERE r.id = NEW.reschedule_id\n    FOR UPDATE;");
	assertStringIncludes(body, "ERRCODE = 'object_not_in_prerequisite_state'");
	// A vote needs a LIVE vote; a proposal or an approval needs any open round.
	assertStringIncludes(body, "v_status IS DISTINCT FROM 'voting'");
	assertStringIncludes(body, "NOT IN ('collecting', 'awaiting_counterparty', 'voting')");
	// object_not_in_prerequisite_state IS SQLSTATE 55000, which is what the writer answers 409 on.
	assertStringIncludes(read(WRITER_TS), 'const ROUND_NOT_OPEN = "55000";');
});

Deno.test("the guard and the deadline stamp are attached where the writes happen", () => {
	const sql = read(TRIGGER_SQL).replace(/\s+/g, " ");
	for (
		const ddl of [
			"CREATE OR REPLACE TRIGGER trg_guard_reschedule_proposal_write BEFORE INSERT OR UPDATE OF approved ON scheduling.reschedule_proposals FOR EACH ROW EXECUTE FUNCTION scheduling.fn_guard_reschedule_write ();",
			"CREATE OR REPLACE TRIGGER trg_guard_reschedule_vote_write BEFORE INSERT ON scheduling.proposal_votes FOR EACH ROW EXECUTE FUNCTION scheduling.fn_guard_reschedule_write ();",
			"CREATE OR REPLACE TRIGGER trg_stamp_vote_deadline BEFORE UPDATE OF status ON scheduling.event_reschedules FOR EACH ROW WHEN (NEW.status = 'voting' AND OLD.status IS DISTINCT FROM 'voting') EXECUTE FUNCTION scheduling.fn_stamp_vote_deadline ();",
		]
	) assertStringIncludes(sql, ddl);
});

Deno.test("closing a round locks it before testing it, and approves an accepted attendee slot", () => {
	const body = functionBody(read(FN_SQL), "scheduling.close_reschedule_round");
	const lock = body.indexOf("FOR UPDATE;");
	const close = body.indexOf("SET status = p_status");
	assert(lock > 0 && close > lock, "the round is locked before it is closed");
	assertStringIncludes(
		body,
		"SET approved = true\n        WHERE id = p_resolved_proposal_id AND NOT approved;",
	);
});
