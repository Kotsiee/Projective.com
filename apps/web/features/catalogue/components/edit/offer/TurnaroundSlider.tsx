import type { JSX } from "preact";
import { MilestoneSlider, ToggleSwitch } from "@projective/ui/fields";
import { nearestStop, TURNAROUND_STOPS } from "../../../core/offer-model.ts";

const STOPS = TURNAROUND_STOPS.map((days) => ({
	value: days,
	label: days === 1 ? "1 day" : `${days} days`,
}));

const LABEL_ID = "cat-offer-turnaround";
const HINT_ID = "cat-offer-turnaround-hint";
const DEFAULT_DAYS = 5;

/** Props for {@link TurnaroundSlider}. */
export interface TurnaroundSliderProps {
	/** Delivery time in days; `null` until the seller commits to one. */
	days: number | null;
	onChange: (days: number | null) => void;
}

/**
 * TurnaroundSlider — a One-Off's delivery time on the `MilestoneSlider` stops a buyer recognises
 * (1, 2, 3, 5, 7, 10, 14, 21, 30 days). Committing to a time is a switch, so "not stated" stays a
 * distinct answer rather than whatever stop the handle rests on.
 */
export function TurnaroundSlider(props: TurnaroundSliderProps): JSX.Element {
	const set = props.days !== null;
	return (
		<div class="cat-sec__field">
			<div class="cat-sec__labelrow">
				<span class="cat-sec__label" id={LABEL_ID}>Delivery time</span>
				<ToggleSwitch
					value={set}
					onValueChange={(on) => props.onChange(on ? props.days ?? DEFAULT_DAYS : null)}
					label="State a delivery time"
				/>
			</div>
			{set && (
				<MilestoneSlider
					milestones={STOPS}
					value={nearestStop(props.days ?? DEFAULT_DAYS)}
					onValueChange={(days) => props.onChange(days)}
					aria-label="Delivery time"
					aria-describedby={HINT_ID}
				/>
			)}
			<p class="cat-sec__hint" id={HINT_ID}>
				{set
					? "From the buyer's go-ahead to the final hand-over. Cards show it as the delivery time."
					: "No delivery time is shown to buyers."}
			</p>
		</div>
	);
}
