import type { ComponentChildren, JSX } from "preact";
import { useSignal } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import { Icon } from "@projective/ui/icons";
import "../styles/profile.css";

/**
 * ServicesRow — the one-row clamp around the profile's Services grid, with the "Show all" disclosure
 * beneath it.
 *
 * The cards are SERVER components passed in as children (the `HomeRail` precedent): the first byte
 * carries every listing, and this island only decides how many ROWS of them are visible. Collapsed,
 * the grid keeps its first row and zeroes every row after it (`grid-auto-rows: 0` + `overflow:
 * hidden`, in `profile-services.css`), so the reflow is pure CSS and the column count stays the
 * grid's own — this island never re-derives it.
 *
 * What it does measure is whether anything IS hidden. A card whose `offsetTop` is below the first
 * row's is in a later row, so the disclosure renders only when the grid genuinely overflows one row
 * at the current width, and every hidden cell is stamped `data-hidden` so it leaves the tab order and
 * the accessibility tree (`visibility: hidden`) rather than lurking, focusable, behind the clip. A
 * `ResizeObserver` re-measures on every reflow, because the answer changes with the width.
 *
 * SSR paints the disclosure whenever there is more than one listing — the honest first guess before
 * a width exists — and the first measurement withdraws it if everything fits.
 */
export interface ServicesRowProps {
	/** How many listings the grid holds; drives the SSR guess and the disclosure's count. */
	count: number;
	/** The grid of server-rendered service cards. */
	children: ComponentChildren;
}

const GRID_ID = "profile-services-grid";

export default function ServicesRow({ count, children }: ServicesRowProps): JSX.Element {
	const expanded = useSignal(false);
	const overflowing = useSignal(count > 1);
	const root = useRef<HTMLDivElement>(null);

	useEffect(() => {
		const host = root.current;
		if (!host) return;
		const grid = host.querySelector<HTMLElement>(".ui-grid");
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
	}, [expanded.value]);

	const isOpen = expanded.value;

	return (
		<div class="pf-services__row" ref={root} data-expanded={isOpen ? "true" : "false"}>
			<div id={GRID_ID} class="pf-services__grid">{children}</div>
			{overflowing.value && (
				<div class="pf-services__more">
					<button
						type="button"
						class="pf-services__toggle"
						aria-expanded={isOpen}
						aria-controls={GRID_ID}
						onClick={() => {
							expanded.value = !isOpen;
						}}
					>
						<span class="pf-services__toggle-label">
							{isOpen ? "Show less" : `Show all ${count}`}
						</span>
						<Icon name="chevron-down" size="sm" class="pf-services__toggle-icon" />
					</button>
				</div>
			)}
		</div>
	);
}
