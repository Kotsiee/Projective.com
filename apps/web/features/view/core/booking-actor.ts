import type { State } from "@web/utils/state.ts";
import type { UserContext } from "@projective/types/auth";
import type { BookingActor } from "@server/services/booking/BookingBackendService.ts";
import { ANONYMOUS_ACTOR } from "@server/services/booking/BookingBackendService.ts";

/**
 * Resolve WHO IS BOOKING, from the request's own state.
 *
 * It reads `ctx.state` — populated by the middlewares from the session cookie — and NEVER a query
 * string or a request body. That is the same rule the scheduling viewer follows and it is load-bearing
 * for the same reason: an actor a caller could describe is an actor a caller could invent, and every
 * write below it puts a line in somebody's basket or a project in somebody's workspace.
 *
 * `isAuthenticated` is the site-wide skeleton presence check (Decision #14), so this governs only what
 * the surface OFFERS. RLS remains the real gate once the live paths land, and every fat method refuses
 * a `userId` of `null` on its own account rather than trusting the caller to have checked.
 */
export function bookingActorFrom(state: State): BookingActor {
	if (!state.isAuthenticated) return ANONYMOUS_ACTOR;
	const ctx = state.userContext;
	return {
		// The chrome context's user id, bare. `null` when the JWT failed to decode, which degrades to
		// the anonymous refusal rather than to a partially-identified write.
		userId: ctx?.userId ?? null,
		handle: normaliseHandle(ctx?.handle ?? state.handle ?? null),
		owner: ownerScopeOf(ctx),
		workspaceId: ctx?.contextType === "personal" ? null : ctx?.contextId ?? null,
		display: ctx?.displayCurrency ?? null,
	};
}

/**
 * The same resolution for the layout's slot resolvers, which are handed a {@link UserContext} rather
 * than the request state.
 *
 * Kept beside {@link bookingActorFrom} so ONE module owns how an actor is named. The two used to be
 * three lines each in two places, which is how a lane and a body come to disagree about whose basket
 * a CTA is adding to.
 */
export function bookingActorFromContext(context: UserContext): BookingActor {
	if (context.role === "guest") return ANONYMOUS_ACTOR;
	return {
		userId: context.userId ?? null,
		handle: normaliseHandle(context.handle),
		owner: ownerScopeOf(context),
		workspaceId: context.contextType === "personal" ? null : context.contextId ?? null,
		display: context.displayCurrency ?? null,
	};
}

/**
 * Whose money the basket spends — `personal`, or `{entity}:{id}` for an entity context.
 *
 * The same `owner` vocabulary `/basket` and `/checkout` already use, rather than a second encoding:
 * a line added from a listing page and the same line read by the basket drawer must resolve to one
 * basket, and two spellings of "this team" is how they come to resolve to two.
 */
function ownerScopeOf(ctx: UserContext | null | undefined): string {
	if (!ctx || ctx.contextType === "personal" || !ctx.contextId) return "personal";
	return `${ctx.contextType}:${ctx.contextId}`;
}

/**
 * Bare, matching the form the corpora carry.
 *
 * The profile corpus stores `@ivy` and the projects corpus stores `ivy`, so an unnormalised handle
 * matches neither reliably — the same normalisation the scheduling viewer performs, for the same
 * reason.
 */
function normaliseHandle(raw: string | null): string | null {
	return raw ? raw.replace(/^@+/, "") : null;
}
