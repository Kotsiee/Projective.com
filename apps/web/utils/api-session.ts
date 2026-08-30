import { actorFrom, type ReadActor } from "@server/services/read-actor.ts";
import { readCookies, SB_ACCESS_COOKIE } from "./auth-cookies.ts";
import { resolveRequestContext } from "./user-context.ts";
import type { State } from "./state.ts";

/**
 * api-session — resolve the acting reader for a route under `apps/web/routes/api/`.
 *
 * ## The gap this closes
 *
 * `ctx.state.accessToken` is written by exactly one middleware — `routes/(dashboard)/_middleware.ts`
 * — and `routes/api/` is a SIBLING of that group, not a child. So on every `/api/*` request the
 * field is `undefined`, no matter how the session is doing. A live read that reached for it would
 * bind `getUserClient(undefined)` and query as the anon role, which under RLS returns nothing and
 * looks exactly like "this user has no projects".
 *
 * The established fix is a cookie fallback — `/api/user/me`, `/api/user/preferences` and
 * `/api/context/switch` each write `ctx.state.accessToken ?? readCookies(ctx.req)[SB_ACCESS_COOKIE]`
 * inline. This module is that same expression, named once, so the fourteen read routes cannot each
 * get it subtly wrong and so the ordering is stated in one place: `ctx.state` FIRST, because when
 * the dashboard guard has silently renewed an expired session the freshly-minted token lives there
 * and the request's cookie is still the stale one.
 *
 * ## What it is not
 *
 * Not a guard. It resolves an identity and returns an anonymous actor when there is none; deciding
 * whether a given read may proceed belongs to the fat service (which refuses) and to RLS (which is
 * the real gate). Keeping resolution and refusal apart is what lets a route be reachable by a guest
 * — which these are, since they sit outside the `(dashboard)` bounce — without every route having to
 * re-derive what "signed out" means.
 */

/** The slice of a Fresh context this resolver reads. Structural, so it is testable without Fresh. */
export interface SessionContext {
	req: Request;
	state: State;
}

/**
 * Resolve the acting reader from the request.
 *
 * The chrome context comes from `ctx.state.userContext` when the global middleware has hydrated it,
 * and is otherwise decoded fresh from the cookie — the middleware runs on every route today, but a
 * route that resolved a guest context because the field was missing would silently serve an empty
 * feed to a signed-in user, and re-deriving is far cheaper than that failure is to diagnose.
 */
export function readActor(ctx: SessionContext): ReadActor {
	const context = ctx.state.userContext ?? resolveRequestContext(ctx.req);
	const accessToken = ctx.state.accessToken ?? readCookies(ctx.req)[SB_ACCESS_COOKIE];
	return actorFrom(context, accessToken);
}
