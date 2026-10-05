import { assert, assertEquals } from "@std/assert";
import { GUEST_CONTEXT, PERSONAL_MEMBER_CONTEXT } from "@projective/types/auth";
import type { SessionContext } from "@web/utils/api-session.ts";
import { legacyDiscussionRedirect } from "./discussion-guard.ts";

/**
 * The discussion room's old-address redirect, pinned against the fixture corpus.
 *
 * Only the room `/discussion` stands for may be moved: a Task's stage (by `stg-…` slug or room id),
 * a staged engagement's project-wide room (by id). A Task's own general room and a staged
 * engagement's stages are OTHER rooms and must keep their addresses — moving one would put a reader
 * in a room they did not ask for. The tail and the query ride along; the redirect is `303`.
 *
 * It is a REDIRECT, not an access gate (it never answers "allowed"), so the answer is pinned
 * identical for every viewer. No request carries an access token, so the read always takes the
 * fixture corpus — exercised end to end with no database.
 */

// #region Fixtures
/** The corpus's one Task, its stage's slug and room id, and its seeded general room. */
const TASK = "prj-cujw52gg3p";
const TASK_STAGE_SLUG = "stg-9768fe95yr";
const TASK_STAGE_ID = "stage-0";
/** Staged engagements: a pipeline, a one-off and a session, each with a project-wide room. */
const PIPELINE = "prj-ghnkqoopo4";
const PIPELINE_STAGE = "stg-ucpv5tnt6o";
const ONE_OFF = "prj-mc9r4c9ha2";
const SESSION = "prj-zsgn999b5g";
const GENERAL = "general";

type Ctx = SessionContext & { url: URL };

function ctx(path: string, method = "GET", state: SessionContext["state"] = {}): Ctx {
	const url = new URL(path, "http://localhost");
	return { req: new Request(url, { method }), state, url };
}

async function location(path: string, method = "GET"): Promise<string | null> {
	const res = await legacyDiscussionRedirect(ctx(path, method));
	if (!res) return null;
	assertEquals(res.status, 303, path);
	return res.headers.get("location");
}
// #endregion

// #region A Task
Deno.test("a Task's stage, by slug or by room id, moves to /discussion", async () => {
	assertEquals(
		await location(`/projects/${TASK}/${TASK_STAGE_SLUG}`),
		`/projects/${TASK}/discussion`,
	);
	assertEquals(
		await location(`/projects/${TASK}/${TASK_STAGE_ID}`),
		`/projects/${TASK}/discussion`,
	);
});

Deno.test("a Task's seeded general room is another room and keeps its address", async () => {
	assertEquals(await location(`/projects/${TASK}/${GENERAL}`), null);
});
// #endregion

// #region Staged engagements
Deno.test("a pipeline, a one-off and a session move their project-wide room", async () => {
	for (const slug of [PIPELINE, ONE_OFF, SESSION]) {
		assertEquals(
			await location(`/projects/${slug}/${GENERAL}`),
			`/projects/${slug}/discussion`,
			slug,
		);
	}
});

Deno.test("a staged engagement's stage is another room and keeps its address", async () => {
	assertEquals(await location(`/projects/${PIPELINE}/${PIPELINE_STAGE}`), null);
	assertEquals(await location(`/projects/${PIPELINE}/stage-0`), null);
});
// #endregion

// #region What rides along
Deno.test("the tab path and the query are carried over", async () => {
	assertEquals(
		await location(`/projects/${TASK}/${TASK_STAGE_SLUG}/submissions/v1?sort=name&dir=asc`),
		`/projects/${TASK}/discussion/submissions/v1?sort=name&dir=asc`,
	);
	assertEquals(
		await location(`/projects/${PIPELINE}/${GENERAL}/chat`),
		`/projects/${PIPELINE}/discussion/chat`,
	);
});

Deno.test("segments are decoded to match and re-encoded on the way out", async () => {
	assertEquals(
		await location(`/projects/${PIPELINE}/gen%65ral`),
		`/projects/${PIPELINE}/discussion`,
	);
	assertEquals(
		await location(`/projects/${PIPELINE}/${GENERAL}/files/a%20b%2Fc`),
		`/projects/${PIPELINE}/discussion/files/a%20b%2Fc`,
	);
});

Deno.test("a trailing slash adds no empty tail", async () => {
	assertEquals(
		await location(`/projects/${PIPELINE}/${GENERAL}/`),
		`/projects/${PIPELINE}/discussion`,
	);
});
// #endregion

// #region What is left alone
Deno.test("the canonical address is never redirected (no loop)", async () => {
	assertEquals(await location(`/projects/${TASK}/discussion`), null);
	assertEquals(await location(`/projects/${PIPELINE}/discussion/chat`), null);
});

Deno.test("only GET and HEAD are moved; a write to the old address is left to its route", async () => {
	const path = `/projects/${PIPELINE}/${GENERAL}`;
	assertEquals(await location(path, "HEAD"), `/projects/${PIPELINE}/discussion`);
	for (const method of ["POST", "PUT", "PATCH", "DELETE", "OPTIONS"]) {
		assertEquals(await legacyDiscussionRedirect(ctx(path, method)), null, method);
	}
});

Deno.test("paths outside a project channel are left alone", async () => {
	for (
		const path of ["/", "/projects", `/projects/${PIPELINE}`, `/messages/${PIPELINE}/${GENERAL}`]
	) {
		assertEquals(await location(path), null, path);
	}
});

Deno.test("an unknown project or an unknown room is left to the route's own miss", async () => {
	assertEquals(await location(`/projects/prj-doesnotexist/${GENERAL}`), null);
	assertEquals(await location(`/projects/${PIPELINE}/no-such-room`), null);
	assertEquals(await location(`/projects/${PIPELINE}/dm-someone`), null);
});

Deno.test("a malformed percent-escape in the path is left to the route's own miss", async () => {
	assertEquals(await legacyDiscussionRedirect(ctx(`/projects/${PIPELINE}/%E0%A4%A`)), null);
});
// #endregion

// #region The viewer does not enter into it
Deno.test("every viewer gets the same answer — the guard reads the room, not the seat", async () => {
	const path = `/projects/${PIPELINE}/${GENERAL}`;
	for (
		const state of [{}, { userContext: GUEST_CONTEXT }, { userContext: PERSONAL_MEMBER_CONTEXT }]
	) {
		const res = await legacyDiscussionRedirect(ctx(path, "GET", state));
		assert(res);
		assertEquals(res.headers.get("location"), `/projects/${PIPELINE}/discussion`);
	}
});
// #endregion
