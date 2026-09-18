import type { ComponentChildren, JSX } from "preact";

/**
 * PairGrid — the two-column collection that collapses to one: open projects and articles, the two
 * entities whose card is a bounded block of TEXT rather than a picture, and which therefore read as
 * alternatives laid side by side rather than as a ranked list or a browsed rail.
 *
 * Two columns wherever the CONTENT REGION can hold two readable cards, one column below that. The
 * decision is a container query on the outer wrapper, never a viewport media query: the same grid
 * renders in a full-width results feed, beside a 280px filter lane, and inside a profile column, and
 * the viewport says nothing about any of those widths. Two elements on purpose — the outer
 * `.ex-pairgrid` is the size container and the inner list takes the columns, because an element
 * cannot query its own inline size (the `ProductMasonryGrid` shape).
 *
 * `wideCells` raises the collapse point: a host whose card is itself a horizontal split (the article
 * card's thumbnail-beside-text) needs each column to clear the card's own fold width, or the grid
 * would hand out two columns of cards that have each folded back to media-on-top.
 *
 * Semantic `<ul>` / `<li>` for assistive tech; zero client JS.
 */
export function PairGrid<T>(
	{ items, label, keyOf, render, wideCells = false }: {
		items: readonly T[];
		/** The list's accessible name. */
		label: string;
		keyOf: (item: T) => string;
		render: (item: T) => ComponentChildren;
		wideCells?: boolean;
	},
): JSX.Element {
	return (
		<div class={wideCells ? "ex-pairgrid ex-pairgrid--wide" : "ex-pairgrid"}>
			<ul class="ex-pairgrid__cols" role="list" aria-label={label}>
				{items.map((item) => (
					<li class="ex-pairgrid__cell" key={keyOf(item)}>
						{render(item)}
					</li>
				))}
			</ul>
		</div>
	);
}
