import type { JSX } from "preact";
import "../styles/view.css";
import MediaGallery from "./MediaGallery.island.tsx";
import ScheduleView from "@web/features/calendar/islands/ScheduleView.island.tsx";
import { ViewIcon } from "../components/view-glyphs.tsx";
import { availabilityMode, setAvailabilityMode } from "../core/view-state.ts";
import type { EntityMedia } from "@projective/types/explore";
import type { SchedulePage } from "@projective/types/scheduling";

/**
 * ServiceShowcase — the Services view's main left showcase region (Part 2). For non-bookable services it
 * is simply the {@link MediaGallery}. For a **Session** / **Group Session** it becomes a two-mode region:
 * the media gallery OR the interactive availability CALENDAR (`@projective/ui/calendar`, via the shared
 * {@link ScheduleView}). The mode is the cross-island {@link availabilityMode} signal — the side-nav
 * lane's `pf-availtoggle` pill writes it, and this island reads it to swap the viewport, so a client can
 * flip to availability, pick a slot, and book in place. A compact in-showcase switch mirrors the lane
 * control (so the calendar is reachable on mobile too, where the lane is hidden).
 */
export interface ServiceShowcaseProps {
	gallery: EntityMedia[];
	title: string;
	/** Session / Group Session — enables the availability-calendar mode + the switch. */
	bookable: boolean;
	/** Whether this is a multi-attendee group session (labels the switch). */
	group?: boolean;
	/** SSR-resolved schedule page for first-paint (falls back to a client fetch by `entityId`). */
	schedule: SchedulePage | null;
	/** The item id — drives the calendar's fallback fetch when SSR produced nothing. */
	entityId: string;
}

export default function ServiceShowcase(
	{ gallery, title, bookable, group = false, schedule, entityId }: ServiceShowcaseProps,
): JSX.Element {
	const showCalendar = bookable && availabilityMode.value;

	if (!bookable) {
		return <MediaGallery gallery={gallery} title={title} />;
	}

	return (
		<div class="vw-showcase" data-mode={showCalendar ? "availability" : "gallery"}>
			<div class="vw-showcase__switch" role="tablist" aria-label="Showcase view">
				<button
					type="button"
					class="vw-showcase__tab"
					role="tab"
					aria-selected={!showCalendar}
					data-active={!showCalendar ? "true" : undefined}
					onClick={() => setAvailabilityMode(false)}
				>
					<ViewIcon name="image" size={16} />
					<span>Showcase</span>
				</button>
				<button
					type="button"
					class="vw-showcase__tab"
					role="tab"
					aria-selected={showCalendar}
					data-active={showCalendar ? "true" : undefined}
					onClick={() => setAvailabilityMode(true)}
				>
					<ViewIcon name="calendar" size={16} />
					<span>{group ? "Session times" : "Availability"}</span>
				</button>
			</div>

			{showCalendar
				? (
					<div class="vw-showcase__calendar">
						<ScheduleView scope="schedule" entityId={entityId} initial={schedule} />
					</div>
				)
				: <MediaGallery gallery={gallery} title={title} />}
		</div>
	);
}
