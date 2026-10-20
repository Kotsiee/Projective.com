import type { JSX } from "preact";
import { MilestoneSlider, ToggleSwitch } from "@projective/ui/fields";
import { nearestStop, TURNAROUND_STOPS } from "../../../core/offer-model.ts";
import { FieldHead } from "../FieldHead.tsx";

const STOPS = TURNAROUND_STOPS.map((days) => ({
	value: days,
	label: days === 1 ? "1 day" : `${days} days`,
}));

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
			<FieldHead
				label="Delivery time"
				hint="From the buyer's go-ahead to the final hand-over; cards show it as the delivery time. Not stated, none is shown."
				hintId={HINT_ID}
			>
				<ToggleSwitch
					value={set}
					onValueChange={(on) => props.onChange(on ? props.days ?? DEFAULT_DAYS : null)}
					label="State a delivery time"
					aria-describedby={HINT_ID}
				/>
			</FieldHead>
			{set && (
				<MilestoneSlider
					milestones={STOPS}
					value={nearestStop(props.days ?? DEFAULT_DAYS)}
					onValueChange={(days) => props.onChange(days)}
					aria-label="Delivery time"
					aria-describedby={HINT_ID}
				/>
			)}
		</div>
	);
}
