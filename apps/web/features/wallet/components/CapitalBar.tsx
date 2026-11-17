import type { JSX } from "preact";
import { MoneyView } from "@projective/ui/display/money";
import { styleVars } from "@ui/core/style.ts";
import type { AllocationSlice } from "../types/wallet-types.ts";
import { fundStateLabel } from "../core/wallet-model.ts";

/**
 * The wallet's capital as it stands now, in one line: a segmented track of the server's allocation
 * slices — Available · Clearing · In escrow · Reserved, in the meter's colours and order, each width the
 * slice's server-drawn `widthBp`, never transitioned — over a meta-register legend of the same figures
 * with middots between them. A compact twin of the overview's balance meter for pages that chart a
 * window, labelled "Balance now" so it is never read as a figure for that window.
 */
export function CapitalBar({ slices }: { slices: readonly AllocationSlice[] }): JSX.Element | null {
	if (slices.length === 0) return null;
	return (
		<div class="wlt-capital">
			<div class="wlt-alloc__bar wlt-capital__bar" aria-hidden="true">
				{slices.map((slice) => (
					<div
						key={slice.state}
						class="wlt-alloc__cell"
						data-state={slice.state}
						data-sliver={slice.sliver ? "true" : undefined}
						style={styleVars({ "--seg": `${slice.widthBp / 100}%` })}
					>
						<span class="wlt-alloc__seg" />
					</div>
				))}
			</div>
			<p class="wlt-capital__legend">
				<span class="wlt-capital__lead">Balance now</span>
				{slices.map((slice) => (
					<span key={slice.state} class="wlt-capital__item" data-state={slice.state}>
						<span class="wlt-capital__mark" aria-hidden="true" />
						{fundStateLabel(slice.state)}{" "}
						<MoneyView value={slice.value} size="micro" hideOrigin class="wlt-capital__figure" />
						<span class="ui-visually-hidden">, {slice.percent}</span>
					</span>
				))}
			</p>
		</div>
	);
}
