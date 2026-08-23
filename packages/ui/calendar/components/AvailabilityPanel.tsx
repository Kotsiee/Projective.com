/**
 * @projective/ui/calendar — the left-panel availability summary (§Part 1.1), shown below the mini-map
 * on the schedule surfaces (`/[handle]/availability`, `/view/[entity]/schedule`). Renders the working
 * timezone (with a live local clock), the weekly working-hours, and the scheduled holidays / blackout
 * dates. Non-interactive: separated by spacing + hairlines, never boxed (§B.4).
 */
import type { JSX } from "preact";
import type { Signal } from "@preact/signals";
import { cx } from "../../core/cx.ts";
import type { CalendarAvailability } from "../core/types.ts";
import { fmtDayLabel, fmtTime } from "../core/time.ts";
import { ClockIcon, GlobeIcon } from "./glyphs.tsx";

const DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function fmtMinuteLabel(min: number, hour12: boolean): string {
	const h = Math.floor(min / 60) % 24;
	const m = min % 60;
	if (!hour12) return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
	const ap = h < 12 ? "AM" : "PM";
	const hh = h % 12 || 12;
	return `${hh}:${String(m).padStart(2, "0")} ${ap}`;
}

export interface AvailabilityPanelProps {
	availability: CalendarAvailability;
	tz: string;
	hour12: boolean;
	/**
	 * The live clock, as a SIGNAL — never read in this component's body. The panel's working-hours table
	 * and blackout list are static for the session; only the clock changes, so only the clock subscribes
	 * (see {@link LocalClock}). Passing a plain number here would re-render the whole panel every minute
	 * to advance four characters.
	 */
	now: Signal<number>;
	/** False until the client has mounted, so SSR renders a placeholder rather than the seed instant. */
	mounted: Signal<boolean>;
}

/**
 * The minute-resolution clock, isolated so the tick reaches exactly one text node. Same reasoning as
 * {@link NowIndicator}: a signal read inside a leaf re-renders that leaf alone.
 */
function LocalClock(
	props: { now: Signal<number>; mounted: Signal<boolean>; zone: string; hour12: boolean },
): JSX.Element {
	return <>{props.mounted.value ? fmtTime(props.now.value, props.zone, props.hour12) : "—:—"}</>;
}

export function AvailabilityPanel(props: AvailabilityPanelProps): JSX.Element {
	const { availability, tz, hour12 } = props;
	const zone = availability.timezone ?? tz;
	const upcoming = availability.blackouts.slice().sort((a, b) => a.start - b.start);

	return (
		<section class="cal-avail" aria-label="Availability">
			<div class="cal-avail__tz">
				<GlobeIcon size={15} class="cal-avail__tz-icon" />
				<span class="cal-avail__tz-name">{zone}</span>
				<span class="cal-avail__tz-time">
					<ClockIcon size={13} />
					<LocalClock now={props.now} mounted={props.mounted} zone={zone} hour12={hour12} />
				</span>
			</div>

			<div class="cal-avail__block">
				<h3 class="cal-avail__heading">Working hours</h3>
				<ul class="cal-avail__hours">
					{DOW.map((label, j) => {
						const weekday = (j + 1) % 7; // Mon-first display → 0=Sun weekday number
						const windows = availability.rules
							.filter((r) => r.weekday === weekday)
							.sort((a, b) => a.startMinute - b.startMinute);
						return (
							<li
								key={label}
								class={cx("cal-avail__row", !windows.length && "cal-avail__row--off")}
							>
								<span class="cal-avail__day">{label}</span>
								<span class="cal-avail__windows">
									{windows.length
										? windows.map((w, i) => (
											<span key={i} class="cal-avail__window">
												{fmtMinuteLabel(w.startMinute, hour12)} –{" "}
												{fmtMinuteLabel(w.endMinute, hour12)}
											</span>
										))
										: <span class="cal-avail__closed">Unavailable</span>}
								</span>
							</li>
						);
					})}
				</ul>
			</div>

			{upcoming.length
				? (
					<div class="cal-avail__block">
						<h3 class="cal-avail__heading">Time off &amp; holidays</h3>
						<ul class="cal-avail__blackouts">
							{upcoming.map((b, i) => (
								<li key={i} class="cal-avail__blackout">
									<span class="cal-avail__blackout-dot" aria-hidden="true" />
									<span class="cal-avail__blackout-body">
										<span class="cal-avail__blackout-label">{b.label}</span>
										<span class="cal-avail__blackout-when">
											{fmtDayLabel(b.start, tz)}
											{b.end - b.start > 86_400_000 ? ` – ${fmtDayLabel(b.end - 1, tz)}` : ""}
										</span>
									</span>
								</li>
							))}
						</ul>
					</div>
				)
				: null}
		</section>
	);
}
