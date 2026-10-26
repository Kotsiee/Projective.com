import type { JSX } from "preact";
import { CALENDAR_KIND_SINGULAR, calendarTime, maskLabel } from "@projective/ui/calendar";
import { Button } from "@projective/ui/fields";
import { ConfirmPopup } from "@projective/ui/feedback";
import { Icon } from "@projective/ui/icons";
import type { CalendarEvent } from "@projective/types/scheduling";
import { openEventModal, requestRemove } from "../core/calendar-state.ts";

/** Props for {@link EventSummary}. */
export interface EventSummaryProps {
	event: CalendarEvent;
	tz: string;
}

/**
 * EventSummary — one entry, read in the `/calendar` right panel's Event tab.
 *
 * A READ surface: what, when, where and whose, then two ways on. Editing lives in the event modal
 * (`.evm__panel`) — the one place an entry is changed — so Edit opens it rather than growing a second
 * editor here. Edit and Delete belong to the entry's host, past or not, by the same rule the modal
 * uses (`viewerIsHost`); anyone else gets Open, which shows them what the modal lets them see.
 *
 * Metadata is inline middot text, never chips (§B.11): none of it is a control.
 */
export function EventSummary({ event, tz }: EventSummaryProps): JSX.Element {
	const mine = event.viewerIsHost === true;
	const when = event.allDay
		? `${calendarTime.fmtFullDate(event.start, tz)} · All day`
		: `${calendarTime.fmtFullDate(event.start, tz)} · ${
			calendarTime.fmtRange(event.start, event.end, tz, true)
		}`;
	const host = mine
		? "You host this"
		: event.organiser
		? `Hosted by ${event.organiser.name}`
		: null;
	const facts = [
		CALENDAR_KIND_SINGULAR[event.kind],
		event.masked ? null : event.location,
		event.attendees != null ? `${event.attendees} going` : null,
	].filter(Boolean).join(" · ");

	return (
		<article class="cal-sum" aria-label="Event details">
			<p class="cal-sum__when">{when}</p>
			<h2 class="cal-sum__title">{event.masked ? maskLabel(event.status) : event.title}</h2>
			<p class="cal-sum__meta">{facts}</p>
			{host ? <p class="cal-sum__meta">{host}</p> : null}
			{!event.masked && event.meta ? <p class="cal-sum__body">{event.meta}</p> : null}

			<div class="cal-sum__acts">
				<Button
					size="sm"
					variant={mine ? "filled" : "outlined"}
					icon={<Icon name={mine ? "edit" : "arrow-up-right"} size="sm" />}
					label={mine ? "Edit event" : "Open details"}
					onClick={() => openEventModal(event.id)}
				/>
				{mine
					? (
						<ConfirmPopup
							label="Delete this event"
							message="Delete this event from your calendar?"
							acceptLabel="Delete"
							rejectLabel="Keep"
							acceptSeverity="danger"
							onAccept={() => requestRemove(event.id)}
							trigger={(api) => (
								<Button
									triggerRef={api.ref}
									size="sm"
									variant="text"
									severity="danger"
									label="Delete"
									aria-expanded={api.expanded ? "true" : "false"}
									aria-controls={api.panelId}
									onClick={api.toggle}
								/>
							)}
						/>
					)
					: null}
				{event.href ? <a class="cal-sum__link" href={event.href}>Go to its project</a> : null}
			</div>
		</article>
	);
}
