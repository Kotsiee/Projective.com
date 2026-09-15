import type { JSX } from "preact";
import { useSignal } from "@preact/signals";
import { useEffect } from "preact/hooks";
import "../styles/profile.css";
import { availabilityAt, hoursSummary, localTimeLabel, wallClockAt } from "../core/hours.ts";
import type { ProfileHours } from "../types/profile-types.ts";

/**
 * ProfileAvailability — the context bar's availability block for a seller with published hours:
 * the live "Available now ⁄ Away" badge with its next edge, the seller's current local time, and the
 * weekly schedule summary, plus the way through to the full bookable calendar.
 *
 * An island only because two of its facts are a function of the CLOCK. It re-derives them on every
 * minute boundary (a timer aligned to `:00`, not a 60-second drift) and on tab re-focus, so a page
 * left open overnight shows the right badge in the morning. The schedule lines and the timezone are
 * static and would be a server component on their own; they ride along so the block has one owner.
 *
 * Every string comes from the pure, clock-injected `core/hours.ts` in one fixed locale, so the
 * server's first byte and the island's first render agree character for character.
 */
export interface ProfileAvailabilityProps {
	hours: ProfileHours;
	/** The full calendar's address (`/[handle]/availability`), or `null` when there is none to link. */
	calendarHref: string | null;
}

const MINUTE_MS = 60_000;

function pad(n: number): string {
	return n < 10 ? `0${n}` : String(n);
}

export default function ProfileAvailability(
	{ hours, calendarHref }: ProfileAvailabilityProps,
): JSX.Element {
	const now = useSignal(Date.now());

	useEffect(() => {
		let timer: ReturnType<typeof setTimeout> | undefined;
		const tick = () => {
			now.value = Date.now();
			timer = setTimeout(tick, MINUTE_MS - (Date.now() % MINUTE_MS));
		};
		tick();
		const onVisible = () => {
			if (document.visibilityState === "visible") now.value = Date.now();
		};
		document.addEventListener("visibilitychange", onVisible);
		return () => {
			clearTimeout(timer);
			document.removeEventListener("visibilitychange", onVisible);
		};
	}, []);

	const state = availabilityAt(hours, now.value);
	const clock = wallClockAt(hours.timezone, now.value);
	const lines = hoursSummary(hours.rules);
	const timeLabel = localTimeLabel(hours.timezone, now.value);
	const timeAttr = `${pad(Math.floor(clock.minute / 60))}:${pad(clock.minute % 60)}`;

	return (
		<div class="pf-avail" data-state={state.available ? "available" : "away"}>
			<p class="pf-avail__now">
				<span class="pf-avail__badge" role="status">
					<span class="pf-avail__dot" aria-hidden="true" />
					{state.available ? "Available now" : "Away"}
				</span>
				<span class="pf-avail__sep" aria-hidden="true">·</span>
				<span class="pf-avail__clock">
					<time dateTime={timeAttr}>{timeLabel}</time> local time
				</span>
			</p>
			{state.nextLabel && <p class="pf-avail__next">{state.nextLabel}</p>}
			{lines.length > 0 && (
				<ul class="pf-avail__lines" role="list" aria-label="Working hours">
					{lines.map((line) => (
						<li class="pf-avail__line" key={line.days}>
							<span class="pf-avail__days">{line.days}</span>
							<span class="pf-avail__times">{line.times}</span>
						</li>
					))}
				</ul>
			)}
			<p class="pf-avail__zone">
				{hours.timezone.replace(/_/g, " ")}
				{calendarHref && (
					<>
						<span class="pf-avail__sep" aria-hidden="true">·</span>
						<a class="pf-avail__link" href={calendarHref}>Full calendar</a>
					</>
				)}
			</p>
		</div>
	);
}
