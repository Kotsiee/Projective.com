import type { SchedulingViewer } from "@projective/types/scheduling";
import { ANONYMOUS_VIEWER } from "@projective/types/scheduling";
import type { State } from "@web/utils/state.ts";

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
 * this governs only what is SHOWN on the PUBLIC scheduling reads (a profile's availability, a
 * listing's schedule) — the private calendar reads and the coordination writes are resolved from the
 * session as a `ReadActor` instead, and run under RLS.
 */
export function viewerFromState(state: State): SchedulingViewer {
	if (!state.isAuthenticated) return ANONYMOUS_VIEWER;
	return signedIn(state.userContext?.handle ?? state.handle ?? null);
}

/**
 * Bare, matching the form every scheduling party carries — the profile corpus stores `@ivy` and the
 * projects corpus stores `ivy`, so an unnormalised handle would match neither reliably.
 */
function signedIn(raw: string | null): SchedulingViewer {
	return { authenticated: true, handle: raw ? raw.replace(/^@+/, "") : null };
}
