import type { ComponentChildren, JSX } from "preact";
import { useSignal } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import { Icon } from "@projective/ui/icons";
import "../styles/profile.css";

/**
 * RowClamp — the one-row clamp around a profile collection (the Services grid, the Products
 * masonry), with the "Show all" disclosure beneath it.
 *
 * The cards are SERVER components passed in as children (the `HomeRail` precedent): the first byte
 * carries every listing, and this island only decides how many ROWS of them are visible. Collapsed,
 * the collection keeps its first row and zeroes every row after it — for a grid, `grid-auto-rows: 0`
 * under `overflow: hidden`; for the masonry, the list is swapped to a grid of exactly its column
 * count — all in `profile-services.css`, so the reflow is pure CSS and the column count stays the
 * collection's own. This island never re-derives it.
 *
 * What it does measure is whether anything IS hidden. A cell whose `offsetTop` is below the first
 * row's is in a later row, so the disclosure renders only when the collection genuinely overflows
 * one row at the current width, and every hidden cell is stamped `data-hidden` so it leaves the tab
 * order and the accessibility tree (`visibility: hidden`) rather than lurking, focusable, behind the
 * clip. A `ResizeObserver` re-measures on every reflow, because the answer changes with the width.
 *
 * SSR paints the disclosure whenever there is more than one item — the honest first guess before a
 * width exists — and the first measurement withdraws it if everything fits.
 */
export interface RowClampProps {
	/** How many items the collection holds; drives the SSR guess and the disclosure's count. */
	count: number;
	/** DOM id for the clamped region, the disclosure's `aria-controls` target. */
	id: string;
	/**
	 * The element whose DIRECT children are the cells (`.ui-grid` for the services grid, the
	 * `.ex-pmasonry__cols` list for the products masonry). Queried inside this island's root.
	 */
	selector: string;
	/** The server-rendered collection. */
	children: ComponentChildren;
}

export default function RowClamp({ count, id, selector, children }: RowClampProps): JSX.Element {
	const expanded = useSignal(false);
	const overflowing = useSignal(count > 1);
	const root = useRef<HTMLDivElement>(null);

	useEffect(() => {
		const host = root.current;
		if (!host) return;
		const grid = host.querySelector<HTMLElement>(selector);
		if (!grid) return;

		const measure = () => {
			const cells = Array.from(grid.children) as HTMLElement[];
			const firstTop = cells[0]?.offsetTop ?? 0;
			let hidden = 0;
			for (const cell of cells) {
				const below = cell.offsetTop > firstTop;
				if (below) hidden++;
				if (below && !expanded.value) cell.setAttribute("data-hidden", "true");
				else cell.removeAttribute("data-hidden");
			}
			overflowing.value = hidden > 0;
		};

		measure();
		const ro = new ResizeObserver(measure);
		ro.observe(grid);
		return () => ro.disconnect();
	}, [expanded.value, selector]);

	const isOpen = expanded.value;

	return (
		<div class="pf-rowclamp" ref={root} data-expanded={isOpen ? "true" : "false"}>
			<div id={id} class="pf-rowclamp__body">{children}</div>
			{overflowing.value && (
				<div class="pf-rowclamp__more">
					<button
						type="button"
						class="pf-rowclamp__toggle"
						aria-expanded={isOpen}
						aria-controls={id}
						onClick={() => {
							expanded.value = !isOpen;
						}}
					>
						<span class="pf-rowclamp__toggle-label">
							{isOpen ? "Show less" : `Show all ${count}`}
						</span>
						<Icon name="chevron-down" size="sm" class="pf-rowclamp__toggle-icon" />
					</button>
				</div>
			)}
		</div>
	);
}
