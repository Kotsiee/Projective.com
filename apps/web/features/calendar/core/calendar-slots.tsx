import type { ComponentChildren } from "preact";
import type { UserContext } from "@projective/types/auth";
import type { SchedulePage } from "@projective/types/scheduling";
import { schedulingSimFromParams } from "@projective/types/scheduling";
import CalendarLane from "../islands/CalendarLane.island.tsx";
import CalendarHeaderBand from "../islands/CalendarHeaderBand.island.tsx";
import CalendarFooterRig from "../islands/CalendarFooterRig.island.tsx";
import { resolvePersonalCalendar } from "./calendar-ssr.ts";
import { viewerFromContext } from "./viewer.ts";

/**
 * calendar-slots — the three URL-keyed resolvers that give `/calendar` its lane and its two bands.
 *
 * The shell renders ABOVE the route, so a page cannot register a band; the correct chrome has to be
 * decided from the URL and shipped in the first byte, which is what every sibling surface does
 * (`walletLaneFor`, `filesHeaderFor`, `basketFooterFor`). Composed in
 * `routes/(dashboard)/_layout.tsx`.
 *
 * All three are SYNCHRONOUS, because their return value goes straight into the render tree and
 * Preact cannot render a promise. That is affordable here in a way it was not for `/files`:
 * `ScheduleBackendService.personalCalendar` is a synchronous fixture read, so the lane and the bands
 * paint their first frame with the same data the grid has rather than seeding from the URL and
 * fetching on mount.
 *
 * The three of them share ONE read per request. The layout calls them from three separate `??`
 * chains, so there is no single call site to thread a result through — but this page is not the
 * cheap per-project read the pattern was written for: it is the UNION of every engagement the
 * account is on, ~320 events, each one carrying a full coordination derivation and its zoned `Intl`
 * placement. Resolving it once per region was that work four times over for one page view.
 *
 * Server-only (they reach `@server/services`); never imported by an island.
 */

/** True for `/calendar` and anything under it. */
function isCalendar(url: URL): boolean {
	return url.pathname === "/calendar" || url.pathname.startsWith("/calendar/");
}

/**
 * The request-scoped memo behind that sharing.
 *
 * Keyed on the `URL` OBJECT, not on its href: Fresh hands every resolver in one render the same
 * instance, and a different request is a different instance, so the entry cannot outlive the request
 * that made it and a `WeakMap` lets it be collected with the URL. That matters because the read is
 * only deterministic WITHIN a request — `withCoordination` consults the fixture mutation store, so
 * an RSVP written between two page views must produce a different answer, and an href-keyed cache
 * would happily serve the older one.
 *
 * The viewer is folded into the stored key rather than the map key: it is the other input the read
 * depends on, and if a future layout ever resolved two viewers against one URL, the mismatch must
 * miss rather than answer with the wrong person's calendar.
 */
const PAGE_CACHE = new WeakMap<URL, { key: string; page: SchedulePage | null }>();

function resolveOnce(url: URL, context: UserContext): SchedulePage | null {
	const viewer = viewerFromContext(context);
	const key = `${viewer.authenticated}|${viewer.handle ?? ""}|${url.search}`;
	const hit = PAGE_CACHE.get(url);
	if (hit && hit.key === key) return hit.page;
	const { page } = resolvePersonalCalendar(viewer, schedulingSimFromParams(url.searchParams));
	PAGE_CACHE.set(url, { key, page });
	return page;
}

/** The lane: mini-month · search · kind filters, over an Events ⁄ Availability tab pair. */
export function calendarLaneFor(url: URL, context: UserContext): ComponentChildren {
	if (!isCalendar(url)) return null;
	return <CalendarLane initial={resolveOnce(url, context)} />;
}

/** The header band: identity · the period trail · search · the filter entry. */
export function calendarHeaderFor(url: URL, context: UserContext): ComponentChildren {
	if (!isCalendar(url)) return null;
	return <CalendarHeaderBand initial={resolveOnce(url, context)} />;
}

/** The footer band: the view switch, Export · Import · Connect · New event, and the action layer. */
export function calendarFooterFor(url: URL, context: UserContext): ComponentChildren {
	if (!isCalendar(url)) return null;
	// A same-origin PATH, not a URL: the consent's `returnTo` is validated server-side and an
	// absolute one is refused, because an attacker-chosen return target turns a consent screen into
	// an open redirect wearing this domain's credibility.
	return <CalendarFooterRig initial={resolveOnce(url, context)} returnTo="/calendar" />;
}
