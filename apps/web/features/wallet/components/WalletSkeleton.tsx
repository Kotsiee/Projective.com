import type { JSX } from "preact";

/**
 * WalletSkeleton — loading placeholders SHAPED LIKE THE BANDS they replace.
 *
 * Generic grey rectangles produce a visible snap when the real content lands, and on a surface whose
 * whole job is conveying custody, a layout that jumps reads as instability. So each shape is built
 * at the real geometry: the hero's figure block and 16px track and four legend columns; the flow
 * band's full chart height; the ledger's row height and column offsets; the deck's fan offsets.
 */
export interface WalletSkeletonProps {
	shape: "hero" | "flow" | "intel" | "rows" | "deck";
	rows?: number;
}

export function WalletSkeleton(props: WalletSkeletonProps): JSX.Element {
	const rows = props.rows ?? 8;

	return (
		<div class={`wlt-skel wlt-skel--${props.shape}`}>
			<span class="ui-visually-hidden" role="status">Loading…</span>
			<div aria-hidden="true">
				{props.shape === "hero" && (
					<>
						<span class="wlt-skel__block wlt-skel__block--figure" />
						<span class="wlt-skel__block wlt-skel__block--track" />
						<span class="wlt-skel__legend">
							{[0, 1, 2, 3].map((i) => <span class="wlt-skel__line" key={i} />)}
						</span>
					</>
				)}
				{props.shape === "flow" && <span class="wlt-skel__block wlt-skel__block--chart" />}
				{props.shape === "intel" && (
					<span class="wlt-skel__plates">
						<span class="wlt-skel__block wlt-skel__block--plate" />
						<span class="wlt-skel__block wlt-skel__block--plate" />
					</span>
				)}
				{props.shape === "rows" && (
					<span class="wlt-skel__rows">
						{Array.from({ length: rows }, (_, i) => <span class="wlt-skel__row" key={i} />)}
					</span>
				)}
				{props.shape === "deck" && (
					<span class="wlt-skel__deck">
						{[0, 1, 2].map((i) => <span class="wlt-skel__card" key={i} data-i={i} />)}
					</span>
				)}
			</div>
		</div>
	);
}
