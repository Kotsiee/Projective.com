import type { JSX } from "preact";
import { useSignal } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import { VirtualGrid } from "@projective/ui/display";
import { ListingCard } from "../ListingCard.tsx";
import { ConsoleSkeleton } from "../ConsoleStates.tsx";
import { aspectFraction, cssLengthPx, listingHref } from "../../core/catalogue-model.ts";
import { gridColWidth, zoom } from "../../core/view-state.ts";
import type { ListingAction } from "../../core/console-actions.ts";
import type { ListingSummary } from "../../types/catalogue-types.ts";

/**
 * ListingsGrid — the console's card presentation (above the zoom centre marker): a window-virtualized
 * `VirtualGrid` of {@link ListingCard}s. Row height is the cover's aspect ratio times the cell width,
 * plus the card body and the gap — all three read from the stylesheet's tokens at mount
 * (`--card-media-ratio`, `--cat-card-body`, `--cat-grid-gap`), so the virtualizer and the CSS cannot
 * disagree about how tall a card is.
 */

export interface ListingsGridProps {
	items: ListingSummary[];
	selected: ReadonlySet<string>;
	loading: boolean;
	onSelect: (listing: ListingSummary, range: boolean) => void;
	onAction: (action: ListingAction, listing: ListingSummary) => void;
	onReachEnd: () => void;
}

const METRIC_RETRY_MS = 100;
const METRIC_TRIES = 100;

interface GridMetrics {
	gap: number;
	body: number;
	media: number;
}

function readGridMetrics(el: HTMLElement): GridMetrics | null {
	const style = getComputedStyle(el);
	const rootPx = Number.parseFloat(getComputedStyle(document.documentElement).fontSize);
	if (!Number.isFinite(rootPx)) return null;
	const gap = cssLengthPx(style.getPropertyValue("--cat-grid-gap"), rootPx);
	const body = cssLengthPx(style.getPropertyValue("--cat-card-body"), rootPx);
	const media = aspectFraction(style.getPropertyValue("--card-media-ratio"));
	return gap === null || body === null || media === null ? null : { gap, body, media };
}

export function ListingsGrid(props: ListingsGridProps): JSX.Element {
	const ref = useRef<HTMLDivElement>(null);
	const metrics = useSignal<GridMetrics | null>(null);

	useEffect(() => {
		let tries = 0;
		const attempt = (): boolean => {
			const read = ref.current ? readGridMetrics(ref.current) : null;
			if (read) metrics.value = read;
			return read !== null || ++tries >= METRIC_TRIES;
		};
		if (attempt()) return;
		const timer = setInterval(() => {
			if (attempt()) clearInterval(timer);
		}, METRIC_RETRY_MS);
		return () => clearInterval(timer);
	}, []);

	const m = metrics.value;
	const selecting = props.selected.size > 0;
	return (
		<div class="cat-grid" ref={ref}>
			{m
				? (
					<VirtualGrid
						items={props.items}
						minColWidth={gridColWidth(zoom.value)}
						rowHeight={(w) => Math.round(w * m.media + m.body + m.gap)}
						gap={m.gap}
						useWindow
						overscan={3}
						loading={props.loading}
						onReachEnd={props.onReachEnd}
						getItemKey={(l) => l.id}
						aria-label="Listings"
						itemTemplate={(l) => (
							<ListingCard
								listing={l}
								href={listingHref(l.id)}
								selected={props.selected.has(l.id)}
								selecting={selecting}
								onSelect={props.onSelect}
								onAction={props.onAction}
							/>
						)}
					/>
				)
				: <ConsoleSkeleton grid />}
		</div>
	);
}
