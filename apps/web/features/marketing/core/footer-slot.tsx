import type { ComponentChildren } from "preact";
import { PublicFooter } from "../components/PublicFooter.tsx";

/**
 * publicFooterFor — the URL-keyed resolver that decides whether a public surface carries the marketing
 * footer, mirroring the shell's other slot resolvers (`exploreFilterLaneFor`, `viewLaneFor`,
 * `viewHeaderFor`, `checkoutChromeFor`): a pure function of the URL, evaluated by the layout, so the
 * footer paints in the first byte with no client-context flash.
 *
 * It exists because the footer used to be structural rather than routed — `GuestShell` rendered it
 * unconditionally, which meant a SIGNED-IN visitor on `/`, `/explore`, `/view/[id]` or `/[handle]` got
 * no footer at all, since those layouts switch to `UserShell`. The fix cannot be "render it in
 * `UserShell` too": the authenticated shell also renders every `(dashboard)` surface, and a marketing
 * masthead under the Kanban board would be absurd. So the decision moves to where every other
 * shell-level decision on these layouts already lives — a resolver the two public layouts call.
 *
 * The guest branch keeps rendering `PublicFooter` itself (`GuestShell` owns its own, including the
 * full-width lane-route arrangement where the footer is a sibling of the scroll region). This resolver
 * feeds the AUTHENTICATED branch only, so no route can produce two.
 */

// #region Full-page exemptions
/**
 * The surfaces that opt out. Each is a full-page calendar that fills the content region and owns its
 * own internal scrolling, so a footer below it would either be unreachable or would turn a fixed-height
 * surface into a scrolling one.
 *
 * These are the same three the `[handle]` layout already exempts by passing `footer={false}` to
 * `GuestShell` — except `/view/[entity]/schedule`, which the guest shell DOES currently footer. See the
 * note on {@link publicFooterFor}.
 */
function isFullPageSurface(segments: string[]): boolean {
	// `/view/{entity}/schedule` — the public session-schedule calendar.
	if (segments.length === 3 && segments[0] === "view" && segments[2] === "schedule") return true;
	// `/{handle}/availability` — the profile availability calendar.
	if (segments.length === 2 && segments[1] === "availability") return true;
	// `/{handle}/view/{item}/schedule` — the profile-scoped session-schedule calendar.
	if (segments.length === 4 && segments[1] === "view" && segments[3] === "schedule") return true;
	return false;
}
// #endregion

// #region Resolver
/**
 * The marketing footer for `url`, or `null` where the surface deliberately has none.
 *
 * The zero-scroll auth surfaces (`/join`, `/login`, `/forgot-password`, `/verify`) are not listed
 * here: the `(public)` layout returns before it ever reaches a shell for those, so they are exempted by
 * composition rather than by a path check — the same arrangement `PublicFooter`'s own doc comment
 * describes, and worth preserving because a second list of auth paths is a second thing to forget.
 *
 * One deliberate asymmetry, flagged rather than silently unified: on `/view/[entity]/schedule` a GUEST
 * gets a footer today (the `(public)` layout does not pass `footer={false}` for it, unlike the two
 * profile-scoped calendars) while this returns `null`. Making the authed branch match the guest branch
 * would be propagating what looks like an oversight; making the guest branch match this one is a change
 * to shipped guest behaviour and belongs to whoever owns that route.
 */
export function publicFooterFor(url: URL): ComponentChildren | null {
	const segments = url.pathname.split("/").filter(Boolean);
	if (isFullPageSurface(segments)) return null;
	return <PublicFooter />;
}
// #endregion
