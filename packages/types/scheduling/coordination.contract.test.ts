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
	RESCHEDULE_ATTENDEE_PROPOSALS_MAX,
	RESCHEDULE_LOCKOUT_HOURS,
	RESCHEDULE_PROPOSALS_MAX,
	RESCHEDULE_SLOT_MAX_HOURS,
	RescheduleRefusalReason,
	VOTE_RESOLUTION_LEAD_HOURS,
} from "./coordination.ts";
import { GUEST_ADDRESS_MAILS_DAILY_MAX, GUEST_INVITES_DAILY_MAX } from "./guests.ts";
import { EVENT_ROSTER_MAX } from "./invitations.ts";

const REPO = new URL("../../../", import.meta.url);
/** File text with line endings normalised, so an assertion never depends on how git checked it out. */
const read = (rel: string) => Deno.readTextFileSync(new URL(rel, REPO)).replace(/\r\n/g, "\n");

const FN_SQL = "supabase/migrations/00001510_functions_scheduling.sql";
const TRIGGER_SQL = "supabase/migrations/00001860_triggers_scheduling.sql";
const TABLE_SQL = "supabase/migrations/00000022_tables_scheduling.sql";
const SESSIONS_SQL = "supabase/migrations/00001155_functions_projects_sessions.sql";
const PARAMS_SQL = "supabase/migrations/00005001_seed_platform_params.sql";
const WRITER_TS = "packages/backend/services/scheduling/live-coordination-writes.ts";
const SEED_TS = "supabase/seeds/gen/emit-scheduling.ts";

/** The body of one `CREATE OR REPLACE FUNCTION <name>()` … `$$;` block (either spacing before `(`). */
function functionBody(sql: string, name: string): string {
	const head = `CREATE OR REPLACE FUNCTION ${name}`;
	const tight = sql.indexOf(`${head}(`);
	const start = tight >= 0 ? tight : sql.indexOf(`${head} (`);
	assert(start >= 0, `${name} is no longer defined`);
	const end = sql.indexOf("\n$$;", start);
	assert(end > start, `${name} has no terminating $$;`);
	return sql.slice(start, end);
}

/** Whitespace collapsed, so a predicate reads the same however it is wrapped. */
const flat = (s: string) => s.replace(/\s+/g, " ");

/** A `security.platform_params` seed value by key, as a number. */
function seededParam(key: string): number {
	const m = read(PARAMS_SQL).match(new RegExp(`'${key}',\\s*'(\\d+)'::jsonb`));
	assert(m, `${key} is not seeded in ${PARAMS_SQL}`);
	return Number(m[1]);
}

Deno.test("the invitation door caps an entry at the SAME seats the TypeScript rule does", () => {
	const body = functionBody(read(FN_SQL), "scheduling.invite_to_event");
	const caps = [...body.matchAll(/v_seats\s*>\s*(\d+)/g)].map((m) => Number(m[1]));
	assertEquals(caps, [EVENT_ROSTER_MAX]);
});

Deno.test("the invitation door limits a person's email invitations at the SAME daily figure", () => {
	const body = functionBody(read(FN_SQL), "scheduling.invite_to_event");
	const caps = [...body.matchAll(/fn_spend_guest_quota\(v_caller::text, [^,]+, (\d+)\)/g)]
		.map((m) => Number(m[1]));
	assertEquals(caps, [GUEST_INVITES_DAILY_MAX]);
});

Deno.test("an address has the SAME daily limit at the door and at the sweep", () => {
	const sql = read(FN_SQL);
	const door = [
		...functionBody(sql, "scheduling.invite_to_event")
			.matchAll(/fn_spend_guest_quota\(v_hash, 1, (\d+)\)/g),
	].map((m) => Number(m[1]));
	const sweep = [
		...functionBody(sql, "scheduling.claim_guest_mail")
			.matchAll(/fn_spend_guest_quota\(scheduling\.fn_guest_hash\(a\.email\), 1, (\d+)\)/g),
	]
		.map((m) => Number(m[1]));
	assertEquals(door, [GUEST_ADDRESS_MAILS_DAILY_MAX]);
	assertEquals(sweep, [GUEST_ADDRESS_MAILS_DAILY_MAX]);
});

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

Deno.test("a discovery call's move door uses the TypeScript lockout", () => {
	const body = functionBody(read(FN_SQL), "scheduling.propose_call_time");
	const lockout = [...body.matchAll(/v_lockout interval := interval '(\d+) hours'/g)].map((m) =>
		Number(m[1])
	);
	assertEquals(lockout, [RESCHEDULE_LOCKOUT_HOURS]);
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

Deno.test("the session workspace counts the voters eligibleVoterCount counts", () => {
	// Decision #343, ruling C6 D5: one denominator. `eligibleVoterCount` leaves out the host and a
	// guest (a seat with no account) and keeps optional seats; so do the workspace and the guard.
	const workspace = flat(functionBody(read(SESSIONS_SQL), "projects.get_session_workspace"));
	const voters = workspace.match(
		/'voters', \(SELECT count\(\*\) FROM scheduling\.event_attendees ea WHERE (.+?)\)\s*\)/,
	);
	assert(voters, "get_session_workspace no longer reports a voters count");
	const predicate = voters[1];
	for (
		const term of [
			"ea.event_id = ev.id",
			"ea.archived_at IS NULL",
			"ea.user_id IS NOT NULL",
			"ea.role <> 'host'::scheduling.attendee_role",
		]
	) assertStringIncludes(predicate, term);
	assert(!predicate.includes("'optional'"), "an optional seat is a voter");

	const guard = flat(functionBody(read(FN_SQL), "scheduling.fn_event_has_voters"));
	for (
		const term of [
			"a.archived_at IS NULL",
			"a.user_id IS NOT NULL",
			"a.role <> 'host'::scheduling.attendee_role",
		]
	) assertStringIncludes(guard, term);
});

Deno.test("the ballot trigger holds the attendee quota and the length rule the planner applies", () => {
	const body = functionBody(read(FN_SQL), "scheduling.fn_cap_reschedule_proposals");
	const quota = [...body.matchAll(/v_mine\s*>=\s*(\d+)/g)].map((m) => Number(m[1]));
	assertEquals(quota, [RESCHEDULE_ATTENDEE_PROPOSALS_MAX]);
	// Only an attendee's slot still waiting on the host counts, and only that attendee's.
	assertStringIncludes(body, "IF NEW.proposed_by_role = 'attendee' AND NOT NEW.approved THEN");
	assertStringIncludes(
		body,
		"p.proposed_by_user_id IS NOT DISTINCT FROM NEW.proposed_by_user_id",
	);
	// A replacement keeps the event's own length.
	assertStringIncludes(body, "SELECT e.ends_at - e.starts_at INTO v_length");
	assertStringIncludes(body, "IF NEW.ends_at - NEW.starts_at IS DISTINCT FROM v_length THEN");
	// The lock is taken before anything is counted.
	assert(body.indexOf("FOR UPDATE") < body.indexOf("INTO v_length"));
	assert(body.indexOf("FOR UPDATE") < body.indexOf("INTO v_mine"));
});

Deno.test("every ballot refusal names a planner reason the writer maps back", () => {
	const body = functionBody(read(FN_SQL), "scheduling.fn_cap_reschedule_proposals");
	const hints = [...body.matchAll(/HINT = '([a-z_]+)'/g)].map((m) => m[1]);
	assertEquals(hints, ["duration_changed", "ballot_full", "proposer_quota"]);
	const writer = read(WRITER_TS);
	for (const hint of hints) {
		assert(RescheduleRefusalReason.safeParse(hint).success, `${hint} is not a refusal reason`);
		assertStringIncludes(writer, `${hint}: { status:`);
	}
	assertStringIncludes(writer, 'error.message?.includes("ck_proposal_span")');
});

Deno.test("no stored slot runs past the TypeScript ceiling", () => {
	const table = flat(read(TABLE_SQL));
	const ceiling = [
		...table.matchAll(
			/CONSTRAINT ck_proposal_span CHECK \( ends_at > starts_at AND ends_at - starts_at <= interval '(\d+) hours' \)/g,
		),
	].map((m) => Number(m[1]));
	assertEquals(ceiling, [RESCHEDULE_SLOT_MAX_HOURS]);
});

Deno.test("a courtesy no-show's dials are seeded and read with the same defaults", () => {
	// Decision #343, ruling C6 D7, at the weight Decision #419 rules: 2 points, lapsing after 90 days,
	// one per pair in 30. A default is only a fallback for a missing row, so it must say the same.
	const body = functionBody(read(FN_SQL), "scheduling.fn_charge_call_no_show");
	const dials: Record<string, number> = {
		call_no_show_penalty_points: 2,
		call_no_show_penalty_days: 90,
		call_no_show_pair_window_days: 30,
	};
	for (const [key, ruled] of Object.entries(dials)) {
		assertEquals(seededParam(key), ruled, `${key} is seeded at the ruled figure`);
		const defaults = [...body.matchAll(new RegExp(`fn_session_param\\('${key}', (\\d+)\\)`, "g"))]
			.map((m) => Number(m[1]));
		assertEquals(defaults, [ruled], `${key} is read once, with the seeded figure as its default`);
	}
	// Courtesy only, and only on the marker's own recorded presence.
	assertStringIncludes(body, "IF c.call_type <> 'courtesy'::scheduling.call_type THEN");
	assertStringIncludes(
		body,
		"WHERE a.call_id = c.id AND a.user_id = p_marker AND a.joined_at <= p_window_closes",
	);
	assertStringIncludes(
		functionBody(read(FN_SQL), "scheduling.mark_call_no_show"),
		"scheduling.fn_charge_call_no_show(c, v_uid, v_named, v_opens)",
	);
});
