import type { JSX } from "preact";
import { Tooltip } from "@projective/ui/feedback";
import { MoneyView } from "@projective/ui/display/money";
import { styleVars } from "@ui/core/style.ts";
import type {
	AllocationSlice,
	FundState,
	IncomingItem,
	WalletOverview,
} from "../types/wallet-types.ts";
import { fundStateHint } from "../core/wallet-home.ts";
import { fundStateLabel } from "../core/wallet-model.ts";
import { FundStateIcon } from "./wallet-glyphs.tsx";

/** Props for {@link AllocationMeter}. */
export interface AllocationMeterProps {
	/** The overview whose server-computed `allocation` the meter draws, and whose stages it names. */
	overview: WalletOverview;
}

/** How many of a state's own items a detail popover lists before summarising the rest. */
const DETAIL_ITEMS = 3;

/** The state's mark: a dot for spendable cash, the fund state's own shape glyph for the rest. */
function StateMark({ state }: { state: FundState }): JSX.Element {
	return state === "available"
		? <span class="wlt-alloc__dot" aria-hidden="true" />
		: <FundStateIcon state={state} size="2xs" class="wlt-alloc__glyph" />;
}

/** The items behind a state, where the overview has them: escrow per stage, releases clearing. */
function itemsOf(state: FundState, incoming: readonly IncomingItem[]): IncomingItem[] {
	if (state === "locked") return incoming.filter((i) => i.kind === "escrow_funded");
	if (state === "pending") return incoming.filter((i) => i.kind === "pending_release");
	return [];
}

/**
 * The detail popover for one slice: what the state is, its figure and share, and — where the overview
 * names them — the stages holding it or the releases clearing, soonest first as the server sent them.
 */
function SliceDetail(
	{ slice, overview }: { slice: AllocationSlice; overview: WalletOverview },
): JSX.Element {
	const items = itemsOf(slice.state, overview.incoming);
	const shown = items.slice(0, DETAIL_ITEMS);
	const rest = items.length - shown.length;
	return (
		<span class="wlt-alloc-pop" data-state={slice.state}>
			<span class="wlt-alloc-pop__head">
				<StateMark state={slice.state} />
				<span class="wlt-alloc-pop__label">{fundStateLabel(slice.state)}</span>
				<span class="wlt-alloc-pop__pct">{slice.percent}</span>
			</span>
			<span class="wlt-alloc-pop__figure">
				<MoneyView value={slice.value} size="body" hideOrigin />
			</span>
			<span class="wlt-alloc-pop__hint">{fundStateHint(slice.state, overview)}</span>
			{shown.length > 0 && (
				<span class="wlt-alloc-pop__items">
					{shown.map((item) => (
						<span key={item.id} class="wlt-alloc-pop__item">
							<span class="wlt-alloc-pop__name">{item.label}</span>
							<span class="wlt-alloc-pop__meta">
								<MoneyView value={item.amount} size="micro" hideOrigin />
								{slice.state === "pending" && (
									<>
										<span class="wlt-dot" aria-hidden="true">·</span>
										{item.clearingLabel}
									</>
								)}
							</span>
						</span>
					))}
					{rest > 0 && <span class="wlt-alloc-pop__more">and {rest} more</span>}
				</span>
			)}
		</span>
	);
}

/**
 * The allocation meter at the head of the dashboard sheet: one track divided between what is spendable,
 * what is clearing its 7-day safety window, what is held in escrow and what is reserved — after the
 * balance summary bar a payments dashboard draws.
 *
 * **Every width is the server's.** Each segment is `flex: 0 0 var(--seg)` with `--seg` the slice's
 * `widthBp` from the overview (`allocationSlices`), the same four figures summed into the total above
 * it; nothing grows, shrinks or animates, so a frozen animation clock cannot draw a share at a width it
 * does not have. A slice under 1.5% is a SLIVER: drawn at a visible floor (the difference taken from the
 * largest slice, so the track still sums to 100%), marked `data-sliver`, and given a pip in the legend
 * so a share that is not nothing never reads as nothing.
 *
 * Pointing at a segment — or focusing its legend entry — opens a popover with the figure, the share,
 * what the state means for this wallet and the stages or releases behind it. Identity never rides on
 * colour alone: clearing is hatched, every entry carries its shape mark and its name, and the legend is
 * a `<dl>` whose terms and figures read in order without the track.
 */
export function AllocationMeter({ overview }: AllocationMeterProps): JSX.Element {
	const slices = overview.allocation;
	return (
		<section class="wlt-section wlt-alloc" aria-labelledby="wlt-alloc-title">
			<header class="wlt-section__head">
				<h2 id="wlt-alloc-title" class="wlt-section__title">Balance breakdown</h2>
			</header>
			{slices.length === 0
				? (
					<>
						<div class="wlt-alloc__bar wlt-alloc__bar--empty" aria-hidden="true" />
						<p class="wlt-alloc__empty">Nothing is held here yet.</p>
					</>
				)
				: (
					<>
						<div class="wlt-alloc__bar" aria-hidden="true">
							{slices.map((slice) => (
								<div
									key={slice.state}
									class="wlt-alloc__cell"
									data-state={slice.state}
									data-sliver={slice.sliver ? "true" : undefined}
									style={styleVars({ "--seg": `${slice.widthBp / 100}%` })}
								>
									<Tooltip
										content={<SliceDetail slice={slice} overview={overview} />}
										placement="bottom"
										class="wlt-alloc__tip"
									>
										<span class="wlt-alloc__seg" />
									</Tooltip>
								</div>
							))}
						</div>
						<dl class="wlt-alloc__legend">
							{slices.map((slice) => (
								<div
									key={slice.state}
									class="wlt-alloc__item"
									data-state={slice.state}
									data-sliver={slice.sliver ? "true" : undefined}
								>
									<dt class="wlt-alloc__dt">
										{/* Above the term: below it, the popover would cover the very figure it explains. */}
										<Tooltip
											content={<SliceDetail slice={slice} overview={overview} />}
											placement="top"
											class="wlt-alloc__tip"
										>
											<span class="wlt-alloc__term" tabIndex={0}>
												<StateMark state={slice.state} />
												<span class="wlt-alloc__label">{fundStateLabel(slice.state)}</span>
												{slice.sliver && <span class="wlt-alloc__pip" aria-hidden="true" />}
											</span>
										</Tooltip>
										<span class="ui-visually-hidden">
											. {fundStateHint(slice.state, overview)}
										</span>
									</dt>
									<dd class="wlt-alloc__dd">
										<MoneyView
											value={slice.value}
											size="body"
											hideOrigin
											class="wlt-alloc__figure"
										/>
										<span class="wlt-alloc__pct">{slice.percent}</span>
									</dd>
								</div>
							))}
						</dl>
					</>
				)}
		</section>
	);
}
