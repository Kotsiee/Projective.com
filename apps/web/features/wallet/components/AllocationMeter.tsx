import type { JSX } from "preact";
import { Tooltip } from "@projective/ui/feedback";
import { MoneyView } from "@projective/ui/display/money";
import { styleVars } from "@ui/core/style.ts";
import type { AllocationPart } from "../core/wallet-home.ts";
import { FundStateIcon } from "./wallet-glyphs.tsx";

/** Props for {@link AllocationMeter}. */
export interface AllocationMeterProps {
	/** The balance's slices — only the fund states that hold something, from `allocationOf`. */
	parts: readonly AllocationPart[];
}

/** The state's mark: a dot for spendable cash, the fund state's own shape glyph for the rest. */
function StateMark({ part }: { part: AllocationPart }): JSX.Element {
	return part.state === "available"
		? <span class="wlt-alloc__dot" aria-hidden="true" />
		: <FundStateIcon state={part.state} size="2xs" class="wlt-alloc__glyph" />;
}

function TipBody({ part }: { part: AllocationPart }): JSX.Element {
	return (
		<span class="wlt-alloc__tip">
			<span class="wlt-alloc__tiphead">
				{part.label} · <MoneyView value={part.value} size="micro" hideOrigin /> · {part.percent}
			</span>
			<span class="wlt-alloc__tiphint">{part.hint}</span>
		</span>
	);
}

/**
 * The four-state allocation meter at the head of the dashboard sheet: one track divided between what
 * is spendable, what is held in escrow, what is clearing its safety window and what is reserved.
 *
 * Every segment's width is its share of the SAME four figures the server summed into the balance, set
 * directly as flex geometry and never transitioned — a frozen animation clock (a backgrounded tab) must
 * never be able to leave a share drawn at the wrong width. Identity never rides on colour alone: the
 * legend names each state beside its shape mark, and the figures are in the hero above and in each
 * item's spoken description.
 */
export function AllocationMeter({ parts }: AllocationMeterProps): JSX.Element {
	return (
		<section class="wlt-section wlt-alloc" aria-labelledby="wlt-alloc-title">
			<header class="wlt-section__head">
				<h2 id="wlt-alloc-title" class="wlt-section__title">Balance breakdown</h2>
			</header>
			{parts.length === 0
				? (
					<>
						<div class="wlt-alloc__bar wlt-alloc__bar--empty" aria-hidden="true" />
						<p class="wlt-alloc__empty">Nothing is held here yet.</p>
					</>
				)
				: (
					<>
						<div class="wlt-alloc__bar" aria-hidden="true">
							{parts.map((part) => (
								<div
									key={part.state}
									class="wlt-alloc__cell"
									data-state={part.state}
									style={styleVars({ "--wlt-share": part.ratio })}
								>
									<Tooltip content={<TipBody part={part} />} placement="bottom">
										<span class="wlt-alloc__seg" />
									</Tooltip>
								</div>
							))}
						</div>
						<ul class="wlt-alloc__legend">
							{parts.map((part) => (
								<li key={part.state} class="wlt-alloc__item" data-state={part.state}>
									<Tooltip content={<TipBody part={part} />} placement="bottom">
										<span class="wlt-alloc__term">
											<StateMark part={part} />
											<span class="wlt-alloc__label">{part.label}</span>
											<span class="wlt-alloc__pct">{part.percent}</span>
										</span>
									</Tooltip>
									<span class="ui-visually-hidden">
										: <MoneyView value={part.value} size="micro" hideOrigin />. {part.hint}.
									</span>
								</li>
							))}
						</ul>
					</>
				)}
		</section>
	);
}
