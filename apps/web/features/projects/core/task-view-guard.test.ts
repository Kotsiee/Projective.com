import { assert, assertEquals } from "@std/assert";
import { GUEST_CONTEXT, PERSONAL_MEMBER_CONTEXT } from "@projective/types/auth";
import type { SessionContext } from "@web/utils/api-session.ts";
import { taskAbsentViewRedirect } from "./task-view-guard.ts";

/**
 * The guard behind `/timeline` and `/calendar` (project- and channel-level), pinned against the
 * fixture corpus. A Task has neither view, so a typed address or an old bookmark is sent — `303`,
 * never cached as permanent — to the page the view would have been a view of; every other archetype
 * renders the view; a slug that resolves to nothing is left to the route's own miss.
 *
 * It is a REDIRECT, not an access gate: it decides between "render" and "go elsewhere", never
 * "allowed", and it reads the engagement's type only. Access is the `(dashboard)` bounce, the route,
 * the fat service and RLS — so the answer is pinned identical for every viewer below.
 *
 * No request here carries an access token, so the read always takes the fixture corpus, whatever
 * `PROJECTS_BACKEND_LIVE` says — the guard is exercised end to end with no database.
 */

// #region Fixtures
/** The corpus's one Task (`one_off` + `single_task`). */
const TASK = "prj-cujw52gg3p";
/** A staged pipeline, a staged one-off and a session — none of them a Task. */
const PIPELINE = "prj-ghnkqoopo4";
const ONE_OFF = "prj-mc9r4c9ha2";
const SESSION = "prj-zsgn999b5g";
/** Staged engagements resting in the other lifecycle states the corpus holds. */
const COMPLETED = "prj-3389ufcjs2";
const ON_HOLD = "prj-xgandqb3cs";
const DRAFT = "prj-t22dcmq5fr";

function ctx(state: SessionContext["state"] = {}): SessionContext {
	return { req: new Request("http://localhost/projects/x/timeline"), state };
}

/** Every viewer the guard could be asked by: anonymous, a guest context, a signed-in member. */
const VIEWERS: [string, SessionContext][] = [
	["anonymous", ctx()],
	["guest", ctx({ userContext: GUEST_CONTEXT })],
	["member", ctx({ userContext: PERSONAL_MEMBER_CONTEXT })],
];
// #endregion

// #region A Task
Deno.test("a Task's timeline or calendar sends the reader to the page it was a view of", async () => {
	for (const destination of [`/projects/${TASK}`, `/projects/${TASK}/stg-9768fe95yr`]) {
		const res = await taskAbsentViewRedirect(ctx(), TASK, destination);
		assert(res, destination);
		assertEquals(res.status, 303);
		assertEquals(res.headers.get("location"), destination);
		assertEquals(res.body, null);
	}
});

Deno.test("the redirect is never permanent, so a Task converted back gets its views again", async () => {
	const res = await taskAbsentViewRedirect(ctx(), TASK, `/projects/${TASK}`);
	assert(res);
	assert(res.status !== 301 && res.status !== 308, `${res.status}`);
	assertEquals(res.headers.get("cache-control"), null);
});
// #endregion

// #region Every other archetype
Deno.test("a pipeline, a one-off and a session render the view", async () => {
	for (const slug of [PIPELINE, ONE_OFF, SESSION]) {
		assertEquals(await taskAbsentViewRedirect(ctx(), slug, `/projects/${slug}`), null, slug);
	}
});

Deno.test("a staged engagement renders the view in every lifecycle state", async () => {
	for (const slug of [COMPLETED, ON_HOLD, DRAFT]) {
		assertEquals(await taskAbsentViewRedirect(ctx(), slug, `/projects/${slug}`), null, slug);
	}
});
// #endregion

// #region A miss
Deno.test("a slug that resolves to nothing is left to the route's own miss", async () => {
	for (
		const slug of ["prj-doesnotexist", "", "discussion", "00000000-0000-0000-0000-000000000000"]
	) {
		assertEquals(await taskAbsentViewRedirect(ctx(), slug, "/projects"), null, slug);
	}
});
// #endregion

// #region The viewer does not enter into it
Deno.test("every viewer gets the same answer — the guard reads the type, not the seat", async () => {
	for (const [who, c] of VIEWERS) {
		const task = await taskAbsentViewRedirect(c, TASK, `/projects/${TASK}`);
		assertEquals(task?.status, 303, who);
		assertEquals(await taskAbsentViewRedirect(c, PIPELINE, `/projects/${PIPELINE}`), null, who);
	}
});
// #endregion
