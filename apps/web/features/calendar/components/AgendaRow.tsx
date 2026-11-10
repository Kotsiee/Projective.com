import type { JSX, VNode } from "preact";
import { calendarTime } from "@projective/ui/calendar";
import { Icon } from "@projective/ui/icons";
import { awaitsAnswer, type CalendarEvent, detectTimeClash } from "@projective/types/scheduling";
import { providerMarkFor } from "./provider-marks.tsx";
import { EventClashNote } from "./EventClashNote.tsx";
import { selectEvent, sourceIsVisible } from "../core/calendar-state.ts";
import { timesLabel } from "../core/event-view.ts";

/** What a row calls an entry. A masked one has only its privacy-safe status. */
export function agendaRowTitle(event: CalendarEvent): string {
	if (!event.masked) return event.title;
	return event.status === "available"
		? "Available"
		: event.status === "tentative"
		? "Tentative"
		: "Busy";
}

/** A row's draggable bindings, for an entry its reader may move into a routine. */
export interface AgendaRowDrag {
	setNodeRef: (el: HTMLElement | null) => void;
	onPointerDown: (e: PointerEvent) => void;
	onGripKeyDown: (e: KeyboardEvent) => void;
	dragging: boolean;
	roleDescription?: string;
}

/** Props for {@link AgendaRow}. */
export interface AgendaRowProps {
	event: CalendarEvent;
	/** How it repeats, for the one row a series gets. */
	repeat: string | null;
	tz: string;
	selected: boolean;
	flashing: boolean;
	/** The whole agenda, read only by a row that clashes, to name what with. */
	all: readonly CalendarEvent[];
	/** Declined, and fading off the list. */
	leaving: boolean;
	/** Present when the row drags into a routine: by its whole row, and from the keyboard by its grip. */
	drag?: AgendaRowDrag;
}

/**
 * AgendaRow — one entry in an agenda list (the `/calendar` lane, a team's or business's Events tab):
 * when, what, and which calendars it is on.
 *
 * The provider marks are the same stack the grid draws, so an entry recognised in the list is
 * recognisable in the grid. A masked block shows its privacy-safe status instead of a title, exactly
 * as it does everywhere else — the list is not a way around the projection.
 *
 * The row is a PICK, not a link: it opens the entry beside the grid and moves the grid onto it. Where
 * the entry lives (its engagement, `href`) is one step further, from the details it opens. The row's
 * rect is what a popover points from, when that is how its reader has things open.
 */
export function AgendaRow(props: AgendaRowProps): JSX.Element {
	const { event, repeat, tz, selected, flashing, all, leaving, drag } = props;
	const title = agendaRowTitle(event);
	const when = event.allDay
		? calendarTime.fmtDayLabel(event.start, tz)
		: `${calendarTime.fmtDayLabel(event.start, tz)} · ${timesLabel(event, tz, true)}`;
	/*
	 * Paired, and filtered on the RESULT of the dispatcher rather than on a rendered component.
	 * `<ProviderMark …/>` is a VNode even when it draws nothing, so filtering on it kept the
	 * platform's own copy and put an empty pip on every row.
	 *
	 * Two suppressions, and each matches the grid so a row and its block never say different things:
	 * a MASKED entry draws none at all (§Part 1.4 allows it one fact — Available / Busy / Tentative —
	 * and which calendar it lives on is not that fact), and a calendar the reader has switched off
	 * draws none either, because a withdrawn layer must leave no trace on the entries it did not take
	 * with it.
	 */
	const marks: { source: string; mark: VNode }[] = [];
	for (const source of event.masked ? [] : event.sources ?? []) {
		if (!sourceIsVisible(source)) continue;
		const mark = providerMarkFor(source, 12);
		if (mark) marks.push({ source, mark });
	}

	const facts = [
		awaitsAnswer(event) ? "Invitation" : null,
		event.meta,
		repeat,
		event.availabilityBehavior === "passive" ? "Passive" : null,
	].filter(Boolean).join(" · ");

	return (
		<div
			class="cal-up"
			data-kind={event.kind}
			data-event-id={event.id}
			data-selected={selected ? "true" : undefined}
			data-flash={flashing ? "true" : undefined}
			data-dragging={drag?.dragging ? "true" : undefined}
			data-leaving={leaving ? "true" : undefined}
			ref={drag?.setNodeRef}
			onPointerDown={drag?.onPointerDown}
		>
			<button
				type="button"
				class="cal-up__link"
				aria-current={selected ? "true" : undefined}
				onClick={(e) => {
					const box = e.currentTarget.getBoundingClientRect();
					selectEvent(event, "list", { x: box.left, y: box.top, w: box.width, h: box.height });
				}}
			>
				<span class="cal-up__body">
					<span class="cal-up__when">{when}</span>
					<span class="cal-up__title">{title}</span>
					{facts ? <span class="cal-up__meta">{facts}</span> : null}
					{event.clashCount
						? (
							<EventClashNote
								clashes={detectTimeClash({ ...event, excludeId: event.id }, all).clashes}
								span={event}
								tz={tz}
							/>
						)
						: null}
				</span>
			</button>
			{marks.length > 0
				? (
					<span class="cal-up__sources" aria-hidden="true">
						{marks.map((m) => <span class="cal-up__source" key={m.source}>{m.mark}</span>)}
					</span>
				)
				: null}
			{drag
				? (
					<button
						type="button"
						class="cal-up__grip"
						aria-label={`Move ${title} to a routine`}
						aria-roledescription={drag.roleDescription}
						onKeyDown={drag.onGripKeyDown}
					>
						<Icon name="grip" size="xs" />
					</button>
				)
				: null}
		</div>
	);
}
