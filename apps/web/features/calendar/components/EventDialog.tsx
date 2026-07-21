import type { JSX } from "preact";
import { type Signal, useSignal } from "@preact/signals";
import { useEffect } from "preact/hooks";
import { Dialog } from "@projective/ui/feedback";
import { Button, InputText } from "@projective/ui/fields";
import { calendarTime } from "@projective/ui/calendar";
import type { CalendarRange } from "@projective/ui/calendar";
import type { CalendarEvent, CalendarEventKind } from "@projective/types/scheduling";

/**
 * EventDialog — the booking / event-creation modal, embedded into the calendar selection actions
 * (§Part 1.3 / §Part 2). STUB-first: creating an event or booking a slot is session-local (the created
 * block appears immediately on the grid) — real persistence + session checkout land behind the live
 * backend gate. Two modes, one dialog: opening an empty range → a create form (title + type + the exact
 * start/end from the drag); opening an existing event → its details (+ a Book action on a bookable slot).
 */

const KIND_LABEL: Record<CalendarEventKind, string> = {
	deadline: "Deadline",
	milestone: "Milestone",
	sync: "Meeting",
	session: "Session",
	booking: "Booking",
	availability: "Available",
	busy: "Busy",
	holiday: "Time off",
	general: "Event",
};

const CREATE_KINDS: Record<"calendar" | "schedule", { v: CalendarEventKind; l: string }[]> = {
	calendar: [
		{ v: "sync", l: "Meeting" },
		{ v: "milestone", l: "Milestone" },
		{ v: "deadline", l: "Deadline" },
		{ v: "session", l: "Session" },
		{ v: "general", l: "Event" },
	],
	schedule: [
		{ v: "session", l: "Session" },
		{ v: "booking", l: "Booking" },
		{ v: "sync", l: "Meeting" },
	],
};

function maskLabel(status?: string): string {
	return status === "available" ? "Available" : status === "tentative" ? "Tentative" : "Busy";
}

export interface EventDialogProps {
	open: Signal<boolean>;
	tz: string;
	hour12?: boolean;
	mode: "calendar" | "schedule";
	/** Create mode — the selected empty range. */
	range?: CalendarRange | null;
	/** View mode — an existing event. */
	event?: CalendarEvent | null;
	/** Whether a bookable slot can be booked (schedule surfaces). */
	canBook?: boolean;
	onCreate?: (event: CalendarEvent) => void;
	onBook?: (event: CalendarEvent) => void;
}

export function EventDialog(props: EventDialogProps): JSX.Element {
	const { open, tz, hour12 = true, mode } = props;
	const title = useSignal("");
	const kind = useSignal<CalendarEventKind>(mode === "schedule" ? "session" : "sync");

	// Reset the create form each time the dialog opens on a fresh range.
	useEffect(() => {
		if (open.value && props.range) {
			title.value = "";
			kind.value = mode === "schedule" ? "session" : "sync";
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [open.value, props.range?.start, props.range?.end]);

	const ev = props.event ?? null;
	const range = props.range ?? null;
	const isView = !!ev;

	function dayLabel(ms: number): string {
		return calendarTime.fmtFullDate(ms, tz);
	}
	function rangeLabel(start: number, end: number, allDay?: boolean): string {
		return allDay ? "All day" : calendarTime.fmtRange(start, end, tz, hour12);
	}

	function submitCreate(): void {
		if (!range) return;
		const created: CalendarEvent = {
			id: `usr-${Date.now()}`,
			title: title.value.trim() || CREATE_KINDS[mode].find((k) => k.v === kind.value)?.l || "Event",
			kind: kind.value,
			status: "confirmed",
			start: range.start,
			end: range.end,
			allDay: range.allDay,
		};
		props.onCreate?.(created);
		open.value = false;
	}

	function submitBook(): void {
		if (!ev) return;
		props.onBook?.({
			...ev,
			id: `booking-${ev.id}-${Date.now()}`,
			title: "You're booked",
			kind: "booking",
			status: "confirmed",
			masked: false,
		});
		open.value = false;
	}

	const canBookThis = !!props.canBook && !!ev &&
		(ev.kind === "availability" || ev.kind === "session") && ev.status !== "cancelled";

	const header = isView ? (ev!.masked ? maskLabel(ev!.status) : ev!.title) : "New event";

	const footer = (
		<div class="cal-dlg__footer">
			<Button variant="text" onClick={() => (open.value = false)}>
				{isView ? "Close" : "Cancel"}
			</Button>
			{isView
				? (canBookThis
					? <Button variant="filled" onClick={submitBook}>Book this slot</Button>
					: null)
				: <Button variant="filled" onClick={submitCreate}>Create</Button>}
		</div>
	);

	return (
		<Dialog visible={open} header={header} footer={footer} width="26rem" class="cal-dlg">
			{isView
				? (
					<dl class="cal-dlg__facts">
						<div class="cal-dlg__fact">
							<dt>When</dt>
							<dd>
								{dayLabel(ev!.start)}
								<br />
								{rangeLabel(ev!.start, ev!.end, ev!.allDay)}
							</dd>
						</div>
						<div class="cal-dlg__fact">
							<dt>Type</dt>
							<dd>{KIND_LABEL[ev!.kind]}</dd>
						</div>
						{ev!.location && !ev!.masked
							? (
								<div class="cal-dlg__fact">
									<dt>Where</dt>
									<dd>{ev!.location}</dd>
								</div>
							)
							: null}
						{typeof ev!.attendees === "number" && !ev!.masked
							? (
								<div class="cal-dlg__fact">
									<dt>Attending</dt>
									<dd>
										{ev!.attendees}
										{typeof ev!.capacity === "number" ? ` / ${ev!.capacity}` : ""}
									</dd>
								</div>
							)
							: null}
						{ev!.masked
							? (
								<div class="cal-dlg__fact">
									<dt>Privacy</dt>
									<dd>External block — shown as {maskLabel(ev!.status)} only.</dd>
								</div>
							)
							: null}
					</dl>
				)
				: (
					<div class="cal-dlg__form">
						<label class="cal-dlg__field">
							<span class="cal-dlg__label">Title</span>
							<InputText value={title} placeholder="Event title" />
						</label>
						<label class="cal-dlg__field">
							<span class="cal-dlg__label">Type</span>
							<select
								class="cal-dlg__select"
								value={kind.value}
								onChange={(e) => (kind.value = (e.currentTarget as HTMLSelectElement).value as CalendarEventKind)}
							>
								{CREATE_KINDS[mode].map((k) => <option key={k.v} value={k.v}>{k.l}</option>)}
							</select>
						</label>
						{range
							? (
								<div class="cal-dlg__when">
									<span class="cal-dlg__label">When</span>
									<span class="cal-dlg__whenval">
										{dayLabel(range.start)} · {rangeLabel(range.start, range.end, range.allDay)}
									</span>
								</div>
							)
							: null}
					</div>
				)}
		</Dialog>
	);
}
