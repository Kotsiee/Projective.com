import type { ComponentChildren } from "preact";
import type { UserContext } from "@projective/types/auth";
import type { PresetListResult, SchedulePage } from "@projective/types/scheduling";
import type { ReadActor } from "@server/services/read-actor.ts";
import { ScheduleBackendService } from "@server/services/scheduling/ScheduleBackendService.ts";
import { once } from "@web/utils/request-memo.ts";
import CalendarLane from "../islands/CalendarLane.island.tsx";
import CalendarHeaderBand from "../islands/CalendarHeaderBand.island.tsx";
import CalendarFooterRig from "../islands/CalendarFooterRig.island.tsx";
import CalendarPanel from "../islands/CalendarPanel.island.tsx";
import AvailabilityLane from "../islands/AvailabilityLane.island.tsx";
import AvailabilityFooter from "../islands/AvailabilityFooter.island.tsx";
import AvailabilityPanel from "../islands/AvailabilityPanel.island.tsx";
import { calendarModeOf, presetSlugOf } from "./availability-view.ts";
import { resolvePersonalCalendar } from "./calendar-ssr.ts";
import { EVENT_PARAM } from "./event-deep-link.ts";

/**
 * calendar-slots — the URL-keyed resolvers that give `/calendar` its lane, its two bands and its
 * panel, for both of its modes: the agenda, and `?view=availability` (Decision #376).
 *
 * The shell renders ABOVE the route, so a page cannot register a band; the correct chrome has to be
 * decided from the URL and shipped in the first byte, which is what every sibling surface does
 * (`walletLaneFor`, `filesHeaderFor`, `basketFooterFor`). Composed in
 * `routes/(dashboard)/_layout.tsx`, which awaits them.
 *
 * Each mode's regions share ONE read per request. The layout calls them from separate `??` chains,
 * so there is no single call site to thread a result through — and the agenda is the UNION of every
 * engagement the account is on, read as them under RLS, so resolving it once per region would be
 * that work three times over (four, with the page body) for one page view. The availability mode
 * reads the acting owner's presets instead, and never the agenda.
 *
 * Server-only (they reach `@server/services`); never imported by an island.
 */

/** True for `/calendar` and anything under it. */
function isCalendar(url: URL): boolean {
	return url.pathname === "/calendar" || url.pathname.startsWith("/calendar/");
}

function isAvailability(url: URL): boolean {
	return calendarModeOf(url) === "availability";
}

/** The reader's agenda, read once per request through the shared request memo. */
function resolveOnce(url: URL, actor: ReadActor): Promise<SchedulePage | null> {
	return once(
		url,
		`calendar|agenda|${actor.userId}|${actor.contextId}`,
		() => resolvePersonalCalendar(actor).then((r) => r.page),
	);
}

/** The acting owner's presets and schedule, read once per request; `null` when unreadable. */
function resolvePresetsOnce(url: URL, actor: ReadActor): Promise<PresetListResult | null> {
	return once(
		url,
		`calendar|presets|${actor.userId}|${actor.contextId}`,
		() => ScheduleBackendService.presets(actor).then((r) => (r.ok && r.data ? r.data : null)),
	);
}

/** The lane: the agenda's search and events, or the availability templates, time off and zone. */
export async function calendarLaneFor(
	url: URL,
	context: UserContext,
	actor: ReadActor,
): Promise<ComponentChildren> {
	if (!isCalendar(url)) return null;
	if (isAvailability(url)) {
		return (
			<AvailabilityLane
				initial={await resolvePresetsOnce(url, actor)}
				presetSlug={presetSlugOf(url)}
				locale={context.locale}
			/>
		);
	}
	return <CalendarLane initial={await resolveOnce(url, actor)} />;
}

/** The header band: the period · the Events ⇄ Availability tabs · the page's actions. */
export async function calendarHeaderFor(
	url: URL,
	context: UserContext,
	actor: ReadActor,
): Promise<ComponentChildren> {
	if (!isCalendar(url)) return null;
	if (isAvailability(url)) {
		return (
			<CalendarHeaderBand
				mode="availability"
				initial={null}
				presets={await resolvePresetsOnce(url, actor)}
				presetSlug={presetSlugOf(url)}
				locale={context.locale}
			/>
		);
	}
	return <CalendarHeaderBand mode="agenda" initial={await resolveOnce(url, actor)} />;
}

/** The right panel: the agenda's event and month navigator, or the template's settings and rules. */
export async function calendarPanelFor(
	url: URL,
	context: UserContext,
	actor: ReadActor,
): Promise<ComponentChildren> {
	if (!isCalendar(url)) return null;
	if (isAvailability(url)) {
		return (
			<AvailabilityPanel
				initial={await resolvePresetsOnce(url, actor)}
				presetSlug={presetSlugOf(url)}
				locale={context.locale}
			/>
		);
	}
	return (
		<CalendarPanel
			initial={await resolveOnce(url, actor)}
			linkedEventId={url.searchParams.get(EVENT_PARAM)}
		/>
	);
}

/** The footer band: the agenda's view control and actions, or the availability Save row. */
export async function calendarFooterFor(
	url: URL,
	context: UserContext,
	actor: ReadActor,
): Promise<ComponentChildren> {
	if (!isCalendar(url)) return null;
	if (isAvailability(url)) {
		return (
			<AvailabilityFooter
				initial={await resolvePresetsOnce(url, actor)}
				presetSlug={presetSlugOf(url)}
				locale={context.locale}
			/>
		);
	}
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

/** The presets for the availability BODY, from the same per-request read the lane uses. */
export function calendarPresetsFor(url: URL, actor: ReadActor): Promise<PresetListResult | null> {
	return resolvePresetsOnce(url, actor);
}
