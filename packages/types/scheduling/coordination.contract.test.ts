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
import { assert, assertEquals, assertNotEquals, assertStringIncludes } from "@std/assert";
import {
	eligibleVoterCount,
	type EventAttendee,
	type EventReschedule,
	EventRescheduleSchema,
	RESCHEDULE_ATTENDEE_PROPOSALS_MAX,
	RESCHEDULE_LOCKOUT_HOURS,
	RESCHEDULE_PROPOSALS_MAX,
	RESCHEDULE_SLOT_MAX_HOURS,
	type RescheduleProposal,
	RescheduleRefusalReason,
	settleVote,
	VOTE_RESOLUTION_LEAD_HOURS,
	voteQuorum,
	votesOfVoters,
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
const READER_TS = "packages/backend/services/scheduling/live-calendar.ts";
const SEED_TS = "supabase/seeds/gen/emit-scheduling.ts";
const SETTLE_PROBE = "supabase/probes/settle_votes.sql";

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

// #region The vote sweep (scheduling.fn_settle_votes, audit S-13, OPS2)
/** One row of `settle_votes.sql`'s contract fixtures, which the probe settles in SQL. */
interface SettleFixture {
	name: string;
	seats: string;
	expect: string;
}

/** The rows between the probe's two `@contract-fixtures` markers. */
function contractFixtures(): SettleFixture[] {
	const probe = read(SETTLE_PROBE);
	const start = probe.indexOf("-- @contract-fixtures begin");
	const end = probe.indexOf("-- @contract-fixtures end");
	assert(start >= 0 && end > start, `${SETTLE_PROBE} has lost its contract fixtures`);
	return [...probe.slice(start, end).matchAll(/\(\d+,\s*'([a-z_]+)',\s*'([^']+)',\s*'([^']+)'\)/g)]
		.map(([, name, seats, expect]) => ({ name, seats, expect }));
}

const HOUR_MS = 3_600_000;
/** The fixture entry's start. Its deadline is 12 hours before; the sweep's clock is an hour before. */
const SITTING = Date.parse("2026-12-01T10:00:00Z");
const PAST_DEADLINE = SITTING - HOUR_MS;
const HOST = { name: "Host", avatar: null, handle: null };

/**
 * A fixture as the read path assembles it: the live roster (a withdrawn seat has left it) and every
 * vote row on the round, whoever cast it, on the host's two slots A and B.
 */
function assemble(fixture: SettleFixture): { roster: EventAttendee[]; round: EventReschedule } {
	const roster: EventAttendee[] = [];
	const ballots: { seat: string; slot: string }[] = [];
	fixture.seats.split(" ").forEach((token, i) => {
		const [seat, ballot] = token.split(":");
		const id = `${seat}-${i}`;
		if (seat !== "withdrawn") {
			roster.push({
				name: id,
				avatar: null,
				handle: null,
				id,
				role: seat === "host" ? "host" : seat === "optional" ? "optional" : "participant",
				response: "pending",
				respondedAt: null,
				isViewer: false,
				note: null,
				...(seat === "guest" ? { isGuest: true } : {}),
			});
		}
		if (ballot === "A" || ballot === "B") ballots.push({ seat: id, slot: ballot });
	});
	const slot = (id: string, start: number): RescheduleProposal => ({
		id,
		start,
		end: start + HOUR_MS,
		proposedBy: HOST,
		proposedByRole: "host",
		proposedAt: SITTING - 48 * HOUR_MS,
		approved: true,
		note: null,
		votes: ballots.filter((b) => b.slot === id).map((b) => ({
			name: b.seat,
			avatar: null,
			handle: null,
			attendeeId: b.seat,
			at: SITTING - 24 * HOUR_MS,
		})),
	});
	return {
		roster,
		round: {
			mode: "vote",
			status: "voting",
			openedBy: HOST,
			openedAt: SITTING - 48 * HOUR_MS,
			proposals: [slot("A", SITTING + 48 * HOUR_MS), slot("B", SITTING + 72 * HOUR_MS)],
			resolvesAt: null,
			resolvedProposalId: null,
			round: 0,
		},
	};
}

/** How a round came to rest, in the fixtures' vocabulary. */
const outcome = (r: EventReschedule) =>
	r.status === "resolved" ? `resolved:${r.resolvedProposalId}` : r.status;

Deno.test("the vote sweep counts the voters eligibleVoterCount counts, and only their ballots", () => {
	const body = flat(functionBody(read(FN_SQL), "scheduling.fn_settle_votes"));
	const seat = [
		"a.event_id = r.event_id",
		"a.archived_at IS NULL",
		"a.user_id IS NOT NULL",
		"a.role <> 'host'::scheduling.attendee_role",
	];
	const electorate = body.match(
		/SELECT count\(\*\)::integer INTO v_voters FROM scheduling\.event_attendees a WHERE (.+?);/,
	);
	assert(electorate, "fn_settle_votes no longer counts its electorate");
	for (const term of seat) assertStringIncludes(electorate[1], term);
	assert(!electorate[1].includes("'optional'"), "an optional seat is a voter");
	const ballots = body.match(
		/FROM scheduling\.proposal_votes v JOIN scheduling\.event_attendees a ON a\.id = v\.attendee_id WHERE (.+?) \) t/,
	);
	assert(ballots, "fn_settle_votes no longer counts a ballot by the seat that cast it");
	for (const term of ["v.proposal_id = p.id", ...seat]) assertStringIncludes(ballots[1], term);
	// The read path drops the same ballots before it settles, so both count one electorate.
	assertStringIncludes(read(READER_TS), "votesOfVoters(proposals, roster)");
});

Deno.test("the vote sweep carries a slot at voteQuorum: strictly more than half", () => {
	const body = flat(functionBody(read(FN_SQL), "scheduling.fn_settle_votes"));
	const carry = body.match(/IF v_winner IS NOT NULL AND (\w+) \* (\d+) > (\w+) THEN/);
	assert(carry, "fn_settle_votes no longer states its majority as `votes * 2 > voters`");
	const [, votes, factor, voters] = carry;
	assertEquals([votes, voters], ["v_top", "v_voters"]);
	// The SQL's arithmetic, run beside the TypeScript threshold over every electorate up to 60.
	for (let n = 0; n <= 60; n++) {
		for (let k = 0; k <= n; k++) {
			assertEquals(k * Number(factor) > n, k >= voteQuorum(n), `${k} of ${n}`);
		}
	}
});

Deno.test("the vote sweep's leader is voteTally's, drawn from the ballot isProposalOnBallot draws", () => {
	const body = flat(functionBody(read(FN_SQL), "scheduling.fn_settle_votes"));
	assertStringIncludes(body, "AND (p.proposed_by_role = 'host' OR p.approved)");
	assertStringIncludes(body, "ORDER BY t.votes DESC, p.starts_at, p.id LIMIT 1;");
});

Deno.test("the vote sweep takes what settleVote settles, past fn_vote_deadline, under the round lock", () => {
	const raw = functionBody(read(FN_SQL), "scheduling.fn_settle_votes");
	const body = flat(raw);
	// Every argument has a default, because the job calls it bare; the job's row names it exactly.
	assertStringIncludes(
		body,
		"p_now timestamptz DEFAULT pg_catalog.now(), p_limit integer DEFAULT 200 )",
	);
	assertStringIncludes(
		read("supabase/migrations/00005060_seed_scheduled_jobs.sql"),
		"'SELECT scheduling.fn_settle_votes();'",
	);
	assertStringIncludes(body, "SECURITY DEFINER SET search_path = ''");
	// A live vote only, past the deadline the read path judges by, or on an empty ballot.
	assertStringIncludes(
		body,
		"WHERE x.mode = 'vote' AND x.status = 'voting' AND COALESCE(scheduling.fn_vote_deadline(x.id) <= p_now, true)",
	);
	assertStringIncludes(
		body,
		"LIMIT GREATEST(COALESCE(p_limit, 200), 1) FOR UPDATE OF x SKIP LOCKED",
	);
	// Re-checked under the lock, then closed through the read path's own door.
	assert(raw.indexOf("FOR UPDATE OF x SKIP LOCKED") < raw.indexOf("INTO v_status, v_mode"));
	assertStringIncludes(
		body,
		"CONTINUE WHEN v_status IS DISTINCT FROM 'voting' OR v_mode IS DISTINCT FROM 'vote' OR v_deadline > p_now;",
	);
	assertStringIncludes(
		body,
		"scheduling.close_reschedule_round( r.id, 'resolved', v_winner, NULL,",
	);
	assertStringIncludes(body, "scheduling.close_reschedule_round( r.id, 'lapsed', NULL, NULL,");
	// A failure is logged in the scheduler's shape, and the run goes on.
	assertStringIncludes(body, "'scheduling-settle-votes', 'settle_failed', 'error',");
});

Deno.test("the vote sweep writes the read path's own history line", () => {
	const body = functionBody(read(FN_SQL), "scheduling.fn_settle_votes");
	const reader = read(READER_TS);
	for (
		const words of [
			"Vote closed without a majority",
			"The original time stands.",
			"Carried by a majority of the attendees.",
		]
	) {
		assertStringIncludes(reader, `"${words}"`);
		assertStringIncludes(body, `'${words}'`);
	}
	assertStringIncludes(reader, "`Moved to ${slotLabel(winner.start, tz)}`");
	assertStringIncludes(body, "'Moved to ' || scheduling.fn_slot_label(v_start, v_tz)");
	const fallback = reader.match(/const FALLBACK_TZ = "([^"]+)";/);
	assert(fallback, "the read path no longer names its fallback zone");
	assertStringIncludes(body, `'${fallback[1]}'`);
});

Deno.test("settleVote settles every settle_votes.sql fixture the way the SQL sweep must", () => {
	const fixtures = contractFixtures();
	assert(fixtures.length >= 10, `only ${fixtures.length} contract fixtures`);
	const discriminating = ["guest_ballots", "withdrawn_ballot", "host_ballot"];
	for (const name of discriminating) {
		assert(fixtures.some((f) => f.name === name), `${name} is no longer a fixture`);
	}
	for (const f of fixtures) {
		const { roster, round } = assemble(f);
		const counted = { ...round, proposals: votesOfVoters(round.proposals, roster) };
		const settled = settleVote(PAST_DEADLINE, counted, eligibleVoterCount(roster), SITTING);
		assertEquals(outcome(settled), f.expect, f.name);
		if (discriminating.includes(f.name)) {
			// Each of these comes out differently if a ballot from outside the electorate is counted.
			const naive = settleVote(PAST_DEADLINE, round, eligibleVoterCount(roster), SITTING);
			assertNotEquals(outcome(naive), f.expect, `${f.name} tells the two countings apart`);
		}
	}
});
// #endregion
