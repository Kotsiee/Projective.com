import type { JSX } from "preact";
import { RatingStars } from "./RatingStars.tsx";
import type { DualRating } from "../types/explore-types.ts";

/**
 * RatingTracks — the dual-track reputation display. Renders one labelled {@link RatingStars} per
 * populated track: freelancers/users carry both "As helper" and "As client"; teams show helper only;
 * businesses show client only (the product rule lives in the fixtures, not here). Compact `inline`
 * layout suits card footers; the default stacked layout suits the detail panel.
 */
export function RatingTracks(
	{ rating, layout = "inline" }: { rating?: DualRating; layout?: "inline" | "stack" },
): JSX.Element | null {
	if (!rating || (!rating.asHelper && !rating.asClient)) return null;
	return (
		<div class={`ex-ratings ex-ratings--${layout}`}>
			{rating.asHelper && (
				<div class="ex-ratings__track">
					<span class="ex-ratings__label">As helper</span>
					<RatingStars
						value={rating.asHelper.value}
						label={`Rated ${rating.asHelper.value} out of 5 as a helper, ${rating.asHelper.count} ratings`}
					/>
					<span class="ex-ratings__value">
						{rating.asHelper.value.toFixed(1)}
						<span class="ex-ratings__count">({rating.asHelper.count})</span>
					</span>
				</div>
			)}
			{rating.asClient && (
				<div class="ex-ratings__track">
					<span class="ex-ratings__label">As client</span>
					<RatingStars
						value={rating.asClient.value}
						label={`Rated ${rating.asClient.value} out of 5 as a client, ${rating.asClient.count} ratings`}
					/>
					<span class="ex-ratings__value">
						{rating.asClient.value.toFixed(1)}
						<span class="ex-ratings__count">({rating.asClient.count})</span>
					</span>
				</div>
			)}
		</div>
	);
}
