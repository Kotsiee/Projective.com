import type { JSX } from "preact";
import type { AvailabilityPreset, IsoDate } from "@projective/types/scheduling";
import { stripDays } from "../../../core/availability-model.ts";

/**
 * UpcomingStrip — the next fortnight of working hours, read-only and inline: one cell per day with
 * its date and its hours (or "Off"), in the preset's own zone. A glance at what buyers can book, not
 * a second editor; the scheduler is one button away.
 */
export function UpcomingStrip(
	props: { preset: AvailabilityPreset; today: IsoDate },
): JSX.Element {
	const days = stripDays(props.preset, props.today, 14);
	return (
		<ol
			class="cat-hours__strip"
			aria-label={`Bookable hours, next 14 days (${props.preset.timezone})`}
		>
			{days.map((day) => (
				<li
					key={day.date}
					class="cat-hours__day"
					data-off={day.bands.length === 0 ? "true" : undefined}
				>
					<span class="cat-hours__date">
						<span class="cat-hours__weekday">{day.weekday}</span>
						<span class="cat-hours__daynum">{day.day}</span>
					</span>
					<span class="cat-hours__times">{day.hours}</span>
				</li>
			))}
		</ol>
	);
}
