import type { SchedulingViewer } from "@projective/types/scheduling";
import { ANONYMOUS_VIEWER } from "@projective/types/scheduling";
import type { State } from "@web/utils/state.ts";
import type { UserContext } from "@projective/types/auth";

/**
 * Resolve WHO IS ASKING for a scheduling read or write, from the request's own state.
 *
 * The fat {@link ScheduleBackendService} withholds an event's roster, meeting link, passcode,
 * attendee notes and host earnings from anyone who is not a party to it, and this is where the
 * "anyone" is decided. It reads `ctx.state` — populated by the middlewares from the session cookie —
 * and NEVER a query string or a request body: a viewer a caller could describe is a viewer a caller
 * could invent, which is why `@projective/types/scheduling` deliberately ships no Zod schema for
 * this shape.
 *
 * `isAuthenticated` is the site-wide skeleton presence check (root CLAUDE.md §8 Decision #14), so
 * this governs only what is SHOWN. RLS remains the real gate once the live path lands.
 */
export function viewerFromState(state: State): SchedulingViewer {
	if (!state.isAuthenticated) return ANONYMOUS_VIEWER;
	return signedIn(state.userContext?.handle ?? state.handle ?? null);
}

/**
 * The same resolution for the layout's slot resolvers, which are handed a {@link UserContext} rather
 * than the request state.
 *
 * Kept here beside {@link viewerFromState} so ONE module owns how a viewer is named — the two used
 * to normalise the handle in separate copies of the same three lines, which is how the bands and the
 * body would eventually come to disagree about who is asking.
 *
 * The discriminators still differ by necessity — the state has `isAuthenticated`, a context has only
 * its chrome `role` — and they can diverge for one request: an authenticated caller whose JWT failed
 * to decode degrades to `GUEST_CONTEXT`. That divergence is cosmetic rather than a privacy
 * difference, because seating is by IDENTITY: a context that produced no handle is seated nowhere by
 * `resolveSeat` whichever way it was labelled, so the withheld projection is what both paths get.
 */
export function viewerFromContext(context: UserContext): SchedulingViewer {
	if (context.role === "guest") return ANONYMOUS_VIEWER;
	return signedIn(context.handle);
}

/**
 * Bare, matching the form every scheduling party carries — the profile corpus stores `@ivy` and the
 * projects corpus stores `ivy`, so an unnormalised handle would match neither reliably.
 */
function signedIn(raw: string | null): SchedulingViewer {
	return { authenticated: true, handle: raw ? raw.replace(/^@+/, "") : null };
}
