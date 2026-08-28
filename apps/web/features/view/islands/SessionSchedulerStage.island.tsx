import type { JSX } from "preact";
import { useSignal } from "@preact/signals";
import { useEffect } from "preact/hooks";
import { Icon } from "@projective/ui/icons";
import "../styles/entity-view.css";
import ScheduleView from "@web/features/calendar/islands/ScheduleView.island.tsx";
import EntityCanvas from "./EntityCanvas.island.tsx";
import { availabilityMode, setAvailabilityMode } from "../core/view-state.ts";
import type { EntityMedia } from "@projective/types/explore";
import type { SchedulePage } from "@projective/types/scheduling";

/**
 * SessionSchedulerStage — the full-width booking stage for the **session** and **cohort** archetypes
 * (`DESIGN_SYSTEM.md` §D.8.3 / §D.8.4).
 *
 * It replaces the old two-column arrangement in which the calendar was squeezed into one hero track.
 * That mattered for a concrete reason rather than an aesthetic one: the calendar engine hides
 * `.cal__side` — the mini-month AND the availability panel — below ~768px of its own ELEMENT width,
 * and a hero column inside a content region that has already spent ~344px on chrome crossed that line
 * on ordinary laptops. The booking surface was silently losing the only control that explains what the
 * provider's working hours are.
 *
 * **The switcher is the single copy of that control.** Previously the in-showcase tablist was
 * `display: none` above 767px and the lane carried a one-way "See all available times" button, so a
 * desktop reader who opened the calendar could not get back to the gallery without reloading. One
 * segmented control, visible at every width, both directions.
 *
 * **It carries no price and no Book CTA.** A booking stage is evaluation material; the offer lives in
 * the conversion lane on desktop and in the body buy bar below `--bp-md` (§D.7.3). A view-mode switch
 * is a data selection, which the canvas is allowed to own.
 */
export interface SessionSchedulerStageProps {
	gallery: EntityMedia[];
	title: string;
	/** SSR-resolved availability — the anonymous, privacy-masked projection. */
	schedule: SchedulePage | null;
	entityId: string;
	/** A cohort labels the calendar "Session times"; a 1-on-1 labels it "Availability". */
	group?: boolean;
	/** The provider's IANA zone, as the engine renders it. Disclosed beside the viewer's own. */
	providerTimezone?: string | null;
}

export default function SessionSchedulerStage(
	{ gallery, title, schedule, entityId, group = false, providerTimezone }:
		SessionSchedulerStageProps,
): JSX.Element {
	const showCalendar = availabilityMode.value;

	/*
	 * The VIEWER's zone, resolved client-side. It is a signal rather than a render-time read because
	 * `Intl.DateTimeFormat().resolvedOptions().timeZone` is not available during SSR, and a server that
	 * guessed would print a timezone the reader does not live in — which is the single most expensive
	 * error a booking surface can make.
	 */
	const viewerZone = useSignal<string | null>(null);
	useEffect(() => {
		try {
			viewerZone.value = Intl.DateTimeFormat().resolvedOptions().timeZone ?? null;
		} catch { /* no Intl zone — the disclosure below simply omits it */ }
	}, []);

	const zones = zoneLine(viewerZone.value, providerTimezone ?? null);

	return (
		<section id="service-scheduler" class="evp-scheduler" aria-label="Availability and showcase">
			<div class="evp-scheduler__bar">
				<div class="evp-scheduler__switch" role="tablist" aria-label="Stage view">
					<button
						type="button"
						class="evp-scheduler__tab"
						role="tab"
						aria-selected={showCalendar ? "true" : "false"}
						data-active={showCalendar ? "true" : undefined}
						onClick={() =>
							setAvailabilityMode(true)}
					>
						<Icon name="calendar" size="sm" aria-hidden />
						<span>{group ? "Session times" : "Availability calendar"}</span>
					</button>
					<button
						type="button"
						class="evp-scheduler__tab"
						role="tab"
						aria-selected={showCalendar ? "false" : "true"}
						data-active={!showCalendar ? "true" : undefined}
						onClick={() =>
							setAvailabilityMode(false)}
					>
						<Icon name="image" size="sm" aria-hidden />
						<span>Showcase gallery</span>
					</button>
				</div>

				{showCalendar && zones && <p class="evp-scheduler__zones">{zones}</p>}
			</div>

			{showCalendar
				? (
					<div class="evp-scheduler__cal">
						<ScheduleView scope="schedule" entityId={entityId} initial={schedule} />
					</div>
				)
				: (
					<div class="evp-scheduler__gallery">
						<EntityCanvas gallery={gallery} title={title} />
					</div>
				)}
		</section>
	);
}

/**
 * The timezone disclosure.
 *
 * The engine renders ONE wall clock from ONE zone string, and `ScheduleView` feeds it the schedule's
 * `timezone` — the PROVIDER's. So a sentence claiming "times are shown in your local timezone" is
 * simply false, and it was shipped that way. Rather than assert either zone, this names the one the
 * grid is actually drawn in and, when they differ, names the reader's too — so a time is unambiguous
 * for both parties without the surface pretending to a conversion it is not performing.
 */
function zoneLine(viewer: string | null, provider: string | null): string | null {
	const pretty = (z: string) => z.replace(/_/g, " ");
	if (provider && viewer && provider !== viewer) {
		return `Times shown in the provider's timezone (${pretty(provider)}). Yours is ${
			pretty(viewer)
		}.`;
	}
	if (provider) return `Times shown in ${pretty(provider)}.`;
	if (viewer) return `Times shown in ${pretty(viewer)}.`;
	return null;
}
