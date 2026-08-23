import type { JSX } from "preact";
import type { Signal } from "@preact/signals";
import { Dialog } from "@projective/ui/feedback";
import { Message } from "@projective/ui/feedback";
import type { AvailabilityRule, CalendarAvailability } from "@projective/types/scheduling";
import "../styles/calendar-chrome.css";

/**
 * AvailabilityManager — the lane's availability block and the modal behind its configure trigger.
 *
 * Three facts, in the order a person asks for them: WHEN AM I WORKING (the weekly bands), WHEN AM I
 * INTERRUPTIBLE (the narrower call windows inside them), and WHEN AM I AWAY (booked leave). They are
 * three layers of one answer rather than three lists, so they share one block and are separated by
 * type weight and a hairline — never by boxing each one (§B.4).
 *
 * The `working_hours` / `call_window` split is the SSOT's own (`AvailabilityRule.kind`, root
 * CLAUDE.md §8 Decision #56): "I am at my desk" and "interrupt me" are two different statements, and
 * a surface that paints them as one band cannot express a person who works all day and takes calls
 * for two hours of it.
 */

const WEEKDAY_LABEL = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

/** `540` → `9:00`. Minutes from local midnight, formatted without a locale so SSR and client agree. */
function clock(minute: number): string {
	const h = Math.floor(minute / 60) % 24;
	const m = minute % 60;
	return `${h}:${String(m).padStart(2, "0")}`;
}

/** A leave span as a plain date range, in the schedule's own zone. */
function spanLabel(startMs: number, endMs: number, tz: string): string {
	const fmt = new Intl.DateTimeFormat("en-GB", { timeZone: tz, day: "numeric", month: "short" });
	const start = fmt.format(new Date(startMs));
	// The end is EXCLUSIVE in the data — a one-day blackout ends at the next midnight — so the label
	// steps back a millisecond. Printing the raw end reads as one day longer than the person booked.
	const end = fmt.format(new Date(endMs - 1));
	return start === end ? start : `${start} – ${end}`;
}

/** Rules grouped by weekday, Monday first, each already sorted by start time. */
function byWeekday(
	rules: readonly AvailabilityRule[],
): { weekday: number; rules: AvailabilityRule[] }[] {
	const out: { weekday: number; rules: AvailabilityRule[] }[] = [];
	// Monday-first: the working week is the unit being described, and a Sunday-first table puts the
	// weekend either side of it.
	for (let i = 0; i < 7; i++) {
		const weekday = (i + 1) % 7;
		const day = rules.filter((r) => r.weekday === weekday).slice().sort((a, b) =>
			a.startMinute - b.startMinute
		);
		if (day.length > 0) out.push({ weekday, rules: day });
	}
	return out;
}

export interface AvailabilityBlockProps {
	availability: CalendarAvailability;
	/**
	 * Opens the configuration modal. OMITTED inside that modal itself — a Configure button on the
	 * thing Configure just opened is a control that cannot do anything the reader has not already
	 * done.
	 */
	onConfigure?: () => void;
}

/** The lane's read-only summary: working hours, call windows, and booked leave. */
export function AvailabilityBlock(props: AvailabilityBlockProps): JSX.Element {
	const days = byWeekday(props.availability.rules);
	const leave = props.availability.blackouts.slice().sort((a, b) => a.start - b.start);
	const tz = props.availability.timezone ?? "UTC";

	return (
		<div class="cal-avail-block">
			<div class="cal-avail-block__head">
				<h3 class="cal-avail-block__title">Availability</h3>
				{props.onConfigure
					? (
						<button
							type="button"
							class="cal-avail-block__configure"
							onClick={props.onConfigure}
							aria-haspopup="dialog"
						>
							Configure
						</button>
					)
					: null}
			</div>

			<p class="cal-avail-block__tz">{tz.replace(/_/g, " ")}</p>

			<ul class="cal-avail-block__days">
				{days.map((day) => (
					<li class="cal-avail-block__day" key={day.weekday}>
						<span class="cal-avail-block__dayname">{WEEKDAY_LABEL[day.weekday]}</span>
						<span class="cal-avail-block__bands">
							{day.rules.map((r) => (
								<span
									class="cal-avail-block__band"
									key={`${r.startMinute}-${r.endMinute}-${r.kind ?? "working_hours"}`}
									data-kind={r.kind ?? "working_hours"}
								>
									{clock(r.startMinute)}–{clock(r.endMinute)}
								</span>
							))}
						</span>
					</li>
				))}
				{days.length === 0 ? <li class="cal-avail-block__none">No working hours set.</li> : null}
			</ul>

			<div class="cal-avail-block__leave">
				<h4 class="cal-avail-block__subtitle">Booked leave</h4>
				{leave.length === 0
					? <p class="cal-avail-block__none">Nothing booked.</p>
					: (
						<ul class="cal-avail-block__leavelist">
							{leave.map((b) => (
								<li class="cal-avail-block__leaveitem" key={`${b.start}-${b.label}`}>
									<span class="cal-avail-block__leavelabel">{b.label}</span>
									<span class="cal-avail-block__leavewhen">{spanLabel(b.start, b.end, tz)}</span>
								</li>
							))}
						</ul>
					)}
			</div>
		</div>
	);
}

export interface AvailabilityDialogProps {
	open: Signal<boolean>;
	availability: CalendarAvailability;
}

/**
 * The configuration modal.
 *
 * It presents the schedule as it stands and says plainly that editing it is not wired yet, rather
 * than offering inputs that would accept a change and drop it. Writing availability needs the
 * `scheduling.availability_rules` / `blackout_dates` write path, which is still behind the backend
 * gate — and a form that silently discards what somebody typed about when they are working is worse
 * than no form.
 */
export function AvailabilityDialog(props: AvailabilityDialogProps): JSX.Element {
	return (
		<Dialog visible={props.open} header="Working hours and leave" width="30rem">
			<Message severity="info" class="cal-avail-dialog__note">
				Editing your hours lands with the scheduling backend. What is below is what your calendar is
				currently drawn from.
			</Message>
			<AvailabilityBlock availability={props.availability} />
		</Dialog>
	);
}
