import type { ComponentChildren } from "preact";
import type { UserContext } from "@projective/types/auth";
import type { SchedulePage } from "@projective/types/scheduling";
import type { ReadActor } from "@server/services/read-actor.ts";
import CalendarLane from "../islands/CalendarLane.island.tsx";
import CalendarHeaderBand from "../islands/CalendarHeaderBand.island.tsx";
import CalendarFooterRig from "../islands/CalendarFooterRig.island.tsx";
import { resolvePersonalCalendar } from "./calendar-ssr.ts";

/**
 * calendar-slots — the three URL-keyed resolvers that give `/calendar` its lane and its two bands.
 *
 * The shell renders ABOVE the route, so a page cannot register a band; the correct chrome has to be
 * decided from the URL and shipped in the first byte, which is what every sibling surface does
 * (`walletLaneFor`, `filesHeaderFor`, `basketFooterFor`). Composed in
 * `routes/(dashboard)/_layout.tsx`, which awaits them.
 *
 * The three of them share ONE read per request. The layout calls them from three separate `??`
 * chains, so there is no single call site to thread a result through — and the agenda is the UNION
 * of every engagement the account is on, read as them under RLS, so resolving it once per region
 * would be that work three times over (four, with the page body) for one page view.
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
 * that made it and a `WeakMap` lets it be collected with the URL. An href-keyed cache would serve one
 * request's agenda to the next — including after an RSVP written between the two page views.
 *
 * It stores the PROMISE, so the three resolvers the layout starts together in one `Promise.all` wait
 * on a single read rather than racing three. The reader's identity is folded into the stored key:
 * it is the other input the read depends on, and if a layout ever resolved two readers against one
 * URL, the mismatch must miss rather than answer with the wrong person's calendar.
 */
const PAGE_CACHE = new WeakMap<URL, { key: string; page: Promise<SchedulePage | null> }>();

function resolveOnce(url: URL, actor: ReadActor): Promise<SchedulePage | null> {
	const key = `${actor.userId}|${actor.contextId}`;
	const hit = PAGE_CACHE.get(url);
	if (hit && hit.key === key) return hit.page;
	const page = resolvePersonalCalendar(actor).then((r) => r.page);
	PAGE_CACHE.set(url, { key, page });
	return page;
}

/** The lane: mini-month · search · kind filters, over an Events ⁄ Availability tab pair. */
export async function calendarLaneFor(
	url: URL,
	_context: UserContext,
	actor: ReadActor,
): Promise<ComponentChildren> {
	if (!isCalendar(url)) return null;
	return <CalendarLane initial={await resolveOnce(url, actor)} />;
}

/** The header band: identity · the period trail · search · the filter entry. */
export async function calendarHeaderFor(
	url: URL,
	_context: UserContext,
	actor: ReadActor,
): Promise<ComponentChildren> {
	if (!isCalendar(url)) return null;
	return <CalendarHeaderBand initial={await resolveOnce(url, actor)} />;
}

/** The footer band: the view switch, Export · Import · Connect · New event, and the action layer. */
export async function calendarFooterFor(
	url: URL,
	_context: UserContext,
	actor: ReadActor,
): Promise<ComponentChildren> {
	if (!isCalendar(url)) return null;
	// A same-origin PATH, not a URL: the consent's `returnTo` is validated server-side and an
	// absolute one is refused, because an attacker-chosen return target turns a consent screen into
	// an open redirect wearing this domain's credibility.
	return <CalendarFooterRig initial={await resolveOnce(url, actor)} returnTo="/calendar" />;
}

/**
 * The agenda for the `/calendar` page BODY, from the same per-request read the three bands use — so
 * the grid and the chrome around it cannot disagree about what is on the week.
 */
export function calendarAgendaFor(url: URL, actor: ReadActor): Promise<SchedulePage | null> {
	return resolveOnce(url, actor);
}
