/**
 * The feedback board's TypeScript SSOT against its SQL (Decision #272). Every rule the board states
 * in both places — the states and categories, the doors' bounds and rate limits, the legal moves, the
 * labels a notification uses, what is public, what takes votes, and which columns a client may read —
 * is read out of the migrations here and compared, so an edit on one side fails until the other
 * follows. A test over file content, like `slug.contract.test.ts`: it runs with no database.
 */
import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import {
	FEEDBACK_BODY_MAX,
	FEEDBACK_CATEGORIES,
	FEEDBACK_IDEA_COLUMNS,
	FEEDBACK_IDEAS_PER_DAY,
	FEEDBACK_IMPACT_MAX,
	FEEDBACK_IMPACT_MIN,
	FEEDBACK_MOVES,
	FEEDBACK_NOTE_MAX,
	FEEDBACK_PUBLIC_STATES,
	FEEDBACK_RESPONSE_MAX,
	FEEDBACK_STATE_LABEL,
	FEEDBACK_STATES,
	FEEDBACK_TITLE_MAX,
	FEEDBACK_TITLE_MIN,
	FEEDBACK_VOTABLE_STATES,
	FEEDBACK_VOTES_PER_HOUR,
	FeedbackStatusEventRowSchema,
} from "./feedback.ts";

const REPO = new URL("../../../", import.meta.url);
const read = (rel: string) => Deno.readTextFileSync(new URL(rel, REPO)).replace(/\r\n/g, "\n");

/** The text of one named region of a migration. */
function region(file: string, name: string): string {
	const sql = read(`supabase/migrations/${file}`);
	const start = sql.indexOf(`-- #region [${name}]`);
	assert(start !== -1, `${file} has no [${name}] region`);
	const end = sql.indexOf("-- #endregion", start);
	return sql.slice(start, end);
}

const TABLES = region("00000025_tables_community.sql", "feedback");
const FUNCTIONS = region("00001320_functions_editorial_community.sql", "community.feedback");
const POLICIES = region("00002021_policies_editorial_community.sql", "community.feedback");
const GRANTS = region("00002520_permissions_table_grants.sql", "community.feedback");

const quoted = (values: readonly string[]) => values.map((v) => `'${v}'`).join(", ");

/** The body of one function in the region, from its CREATE to the closing `$$;`. */
function fn(name: string): string {
	const start = FUNCTIONS.indexOf(`CREATE OR REPLACE FUNCTION community.${name}(`);
	assert(start !== -1, `community.${name} is not defined in [community.feedback]`);
	return FUNCTIONS.slice(start, FUNCTIONS.indexOf("$$;", FUNCTIONS.indexOf("AS $$", start)));
}

// #region Vocabulary
Deno.test("the status CHECK is FEEDBACK_STATES, value for value and in order", () => {
	assertStringIncludes(TABLES, `status IN (${quoted(FEEDBACK_STATES)})`);
	assertStringIncludes(TABLES, `to_status IN (${quoted(FEEDBACK_STATES)})`);
});

Deno.test("the category CHECK is FEEDBACK_CATEGORIES, and the door accepts the same set", () => {
	assertStringIncludes(TABLES, `category IN (${quoted(FEEDBACK_CATEGORIES)})`);
	assertStringIncludes(fn("submit_feedback_idea"), quoted(FEEDBACK_CATEGORIES));
});

Deno.test("the notification labels are the board's labels", () => {
	const body = fn("fn_feedback_state_label");
	for (const state of FEEDBACK_STATES) {
		assertStringIncludes(body, `WHEN '${state}' THEN '${FEEDBACK_STATE_LABEL[state]}'`);
	}
});

Deno.test("fn_feedback_move_legal is FEEDBACK_MOVES", () => {
	const body = fn("fn_feedback_move_legal");
	for (const state of FEEDBACK_STATES) {
		const to = FEEDBACK_MOVES[state];
		if (to.length === 0) {
			assert(!body.includes(`WHEN '${state}' THEN`), `${state} must have no legal move`);
		} else if (to.length === 1) {
			assertStringIncludes(body, `WHEN '${state}' THEN p_to = '${to[0]}'`);
		} else {
			assertStringIncludes(body, `WHEN '${state}' THEN p_to IN (${quoted(to)})`);
		}
	}
	assertStringIncludes(body, "ELSE false");
});
// #endregion

// #region Who sees and who votes
Deno.test("the public SELECT policy and the visibility helper name FEEDBACK_PUBLIC_STATES", () => {
	assertStringIncludes(POLICIES, `USING (status IN (${quoted(FEEDBACK_PUBLIC_STATES)}))`);
	assertStringIncludes(
		fn("fn_feedback_idea_visible"),
		`p_status IN (${quoted(FEEDBACK_PUBLIC_STATES)})`,
	);
	assertStringIncludes(POLICIES, "USING (status = 'backlog' AND author_id = auth.uid())");
	assertStringIncludes(POLICIES, "USING (security.is_admin())");
});

Deno.test("both vote doors accept exactly FEEDBACK_VOTABLE_STATES", () => {
	for (const door of ["vote_feedback_idea", "unvote_feedback_idea"]) {
		assertStringIncludes(fn(door), `v_idea.status NOT IN (${quoted(FEEDBACK_VOTABLE_STATES)})`);
	}
});
// #endregion

// #region Bounds and rate limits
Deno.test("the submit door's bounds are the Zod bounds", () => {
	const body = fn("submit_feedback_idea");
	assertStringIncludes(
		body,
		`char_length(v_title) < ${FEEDBACK_TITLE_MIN} OR char_length(v_title) > ${FEEDBACK_TITLE_MAX}`,
	);
	assertStringIncludes(
		body,
		`char_length(v_impact) < ${FEEDBACK_IMPACT_MIN} OR char_length(v_impact) > ${FEEDBACK_IMPACT_MAX}`,
	);
	assertStringIncludes(body, `char_length(v_body) > ${FEEDBACK_BODY_MAX}`);
	assertStringIncludes(
		fn("respond_to_feedback_idea"),
		`char_length(v_response) > ${FEEDBACK_RESPONSE_MAX}`,
	);
	assertStringIncludes(
		fn("set_feedback_idea_status"),
		`char_length(v_note) > ${FEEDBACK_NOTE_MAX}`,
	);
});

Deno.test("the rate limits are FEEDBACK_IDEAS_PER_DAY and FEEDBACK_VOTES_PER_HOUR", () => {
	const submit = fn("submit_feedback_idea");
	assertStringIncludes(submit, `IF v_recent >= ${FEEDBACK_IDEAS_PER_DAY} THEN`);
	assertStringIncludes(submit, "created_at > now() - interval '24 hours'");
	const vote = fn("vote_feedback_idea");
	assertStringIncludes(vote, `IF v_recent >= ${FEEDBACK_VOTES_PER_HOUR} THEN`);
	assertStringIncludes(vote, "created_at > now() - interval '1 hour'");
});

Deno.test("both rate limits count under one per-person lock, taken before the count", () => {
	const lock = "PERFORM pg_advisory_xact_lock(hashtext('community.feedback:' || v_uid::text));";
	for (const door of ["submit_feedback_idea", "vote_feedback_idea"]) {
		const body = fn(door);
		const at = body.indexOf(lock);
		assert(at !== -1, `${door} takes no per-person lock`);
		assert(at < body.indexOf("SELECT count(*), min(created_at)"), `${door} counts before locking`);
	}
	// The vote door locks the person before the idea's row, so the two locks have one order.
	const vote = fn("vote_feedback_idea");
	assert(vote.indexOf(lock) < vote.indexOf("community.fn_feedback_idea_for_caller(p_slug)"));
});

Deno.test("one moderation call runs the move, then the response, in one statement", () => {
	const body = fn("moderate_feedback_idea");
	const move = body.indexOf("community.set_feedback_idea_status(p_slug, p_status, p_note)");
	const respond = body.indexOf("community.respond_to_feedback_idea(p_slug, p_response)");
	assert(move !== -1 && respond > move, "moderate_feedback_idea must call both doors, move first");
});
// #endregion

// #region What a client may read
/** The column list of the `GRANT SELECT (…) ON <table>` in the region. */
function grantedColumns(table: string): string[] {
	const match = new RegExp(`GRANT SELECT \\(([^)]*)\\)\\s*ON ${table.replace(".", "\\.")} TO`).exec(
		GRANTS,
	);
	assert(match, `no column grant on ${table}`);
	return match[1].split(",").map((c) => c.trim()).filter(Boolean);
}

Deno.test("clients read exactly the idea columns the row schema declares — never the evidence", () => {
	const granted = grantedColumns("community.feedback_ideas");
	assertEquals([...granted].sort(), [...FEEDBACK_IDEA_COLUMNS].sort());
	assert(!granted.includes("pii_categories"));
	assert(!granted.includes("team_response_by"));
});

Deno.test("clients read exactly the history columns the row schema declares — never the operator side", () => {
	const granted = grantedColumns("community.feedback_status_events");
	assertEquals([...granted].sort(), Object.keys(FeedbackStatusEventRowSchema.shape).sort());
	assert(!granted.includes("actor_id"));
	assert(!granted.includes("note"));
});

Deno.test("every door answers the row schema's columns plus viewer_voted", () => {
	const body = fn("fn_feedback_idea_json");
	const keys = [...body.matchAll(/'([a-z_]+)', /g)].map((m) => m[1]);
	assertEquals(keys.sort(), [...FEEDBACK_IDEA_COLUMNS, "viewer_voted"].sort());
});

Deno.test("no client role may write a board table", () => {
	for (const verb of ["INSERT", "UPDATE", "DELETE", "ALL"]) {
		assert(!new RegExp(`GRANT[^;]*\\b${verb}\\b`).test(GRANTS), `a client grant names ${verb}`);
	}
});
// #endregion
