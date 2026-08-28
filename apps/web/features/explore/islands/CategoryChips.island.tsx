import type { JSX } from "preact";
import { Icon } from "@projective/ui/icons";
import { Tooltip } from "@projective/ui/feedback";
import { useCarousel } from "@features/marketing/core/useCarousel.ts";
import { CATEGORY_CHIPS } from "../core/home-model.ts";
import "../styles/explore.css";
import "../styles/explore-home.css";

/**
 * CategoryChips — the non-looping category bar between the hero and the Recommended panel.
 *
 * Every chip is a real anchor into a real `/explore` query, so the bar works with no script at all;
 * this island adds only the overflow affordances. Non-looping is the point: a bar that wraps around
 * gives the reader no way to know they have seen everything in it, which is exactly what an
 * end-of-list boundary is for.
 *
 * **The fade and the arrow disappear together, per side.** They are two halves of one statement —
 * "there is more this way" — and leaving either standing at a boundary makes it a control that lies.
 * The fade is a `mask-image` rather than a gradient overlay so it dissolves the chips into whatever
 * ground is actually behind them rather than into a colour this component had to guess (the same
 * reasoning the profile card's banner mask records).
 *
 * The arrow is `visibility: hidden` at a boundary, not `display: none`: the row must not reflow under
 * the reader's cursor the moment they reach an end.
 */
export default function CategoryChips(): JSX.Element {
	const { trackRef, prev, next, atStart, atEnd } = useCarousel();

	return (
		<nav class="ex-chips" aria-label="Browse by category">
			<Tooltip content="Previous">
				<button
					type="button"
					class="ex-railbtn"
					aria-label="Scroll categories backwards"
					disabled={atStart.value}
					onClick={prev}
				>
					<Icon name="chevron-left" size="sm" />
				</button>
			</Tooltip>

			<div
				class="ex-chips__scroller"
				ref={trackRef}
				data-at-start={atStart.value ? "true" : "false"}
				data-at-end={atEnd.value ? "true" : "false"}
			>
				{CATEGORY_CHIPS.map((chip) => (
					<a class="ex-chip" href={chip.href} data-chip={chip.id} key={chip.id}>
						{chip.label}
					</a>
				))}
			</div>

			<Tooltip content="Next">
				<button
					type="button"
					class="ex-railbtn"
					aria-label="Scroll categories forwards"
					disabled={atEnd.value}
					onClick={next}
				>
					<Icon name="chevron-right" size="sm" />
				</button>
			</Tooltip>
		</nav>
	);
}
