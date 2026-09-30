import type { JSX } from "preact";
import { useSignal } from "@preact/signals";
import { InlineNotice } from "@projective/ui/feedback";
import { Icon } from "@projective/ui/icons";
import { MoneyView } from "@projective/ui/display/money";
import { styleVars } from "@ui/core/style.ts";
import type { ActivityView, FlowPoint } from "../types/wallet-types.ts";
import { flowBars } from "../core/wallet-home.ts";
import { type FlowPeriod, periodPhrase, periodSlicesAreSpans } from "../core/wallet-model.ts";

/** Props for {@link CashFlow}. */
export interface CashFlowProps {
	period: FlowPeriod;
	activity: ActivityView | null;
	loading: boolean;
	error: string | null;
	onRetry: () => void;
	/** The analytics page, linked from the overview's section head. */
	moreHref?: string;
}

function bucketName(period: FlowPeriod, label: string): string {
	return periodSlicesAreSpans(period) ? `From ${label}` : label;
}

/** The window phrase as a heading's meta: "Last 3 months", "All time". */
function windowLabel(period: FlowPeriod): string {
	const phrase = periodPhrase(period).replace(/^the /, "");
	return phrase.charAt(0).toUpperCase() + phrase.slice(1);
}

function FlowChart(
	{ points, currency, period }: {
		points: readonly FlowPoint[];
		currency: string;
		period: FlowPeriod;
	},
): JSX.Element {
	const active = useSignal<number | null>(null);
	const bars = flowBars(points);
	const last = bars.length - 1;
	const focused = active.value !== null ? points[active.value] : null;

	const move = (e: KeyboardEvent) => {
		if (bars.length === 0) return;
		const rtl = getComputedStyle(e.currentTarget as Element).direction === "rtl";
		const forward = rtl ? "ArrowLeft" : "ArrowRight";
		const back = rtl ? "ArrowRight" : "ArrowLeft";
		const at = active.value;
		let next: number | null = at;
		if (e.key === forward) next = at === null ? 0 : Math.min(last, at + 1);
		else if (e.key === back) next = at === null ? last : Math.max(0, at - 1);
		else if (e.key === "Home") next = 0;
		else if (e.key === "End") next = last;
		else if (e.key === "Escape") next = null;
		else return;
		e.preventDefault();
		active.value = next;
	};

	return (
		<figure class="wlt-chart">
			<div
				class="wlt-chart__plot"
				role="group"
				aria-roledescription="chart"
				aria-label={`Money in and out over ${
					periodPhrase(period)
				}. Use the arrow keys to read each bar.`}
				tabIndex={0}
				onKeyDown={move}
				onPointerLeave={() => {
					active.value = null;
				}}
				onBlur={() => {
					active.value = null;
				}}
			>
				{bars.map((bar, i) => (
					<span
						key={`${bar.label}-${i}`}
						class="wlt-chart__col"
						data-active={active.value === i ? "true" : undefined}
						onPointerEnter={() => {
							active.value = i;
						}}
						aria-hidden="true"
					>
						<span class="wlt-chart__up">
							<span
								class="wlt-chart__bar wlt-chart__bar--in"
								style={styleVars({ "--h": bar.inRatio, "--hmin": bar.inRatio > 0 ? "2px" : "0px" })}
							/>
						</span>
						<span class="wlt-chart__down">
							<span
								class="wlt-chart__bar wlt-chart__bar--out"
								style={styleVars({
									"--h": bar.outRatio,
									"--hmin": bar.outRatio > 0 ? "2px" : "0px",
								})}
							/>
						</span>
					</span>
				))}
			</div>
			<div class="wlt-chart__scale" aria-hidden="true">
				<span>{bars[0]?.label ?? ""}</span>
				<span>Today</span>
			</div>
			<p class="wlt-chart__readout" aria-live="polite">
				{focused
					? (
						<>
							<span class="wlt-chart__when">{bucketName(period, focused.label)}</span>
							<span class="wlt-chart__pair">
								<span class="wlt-key wlt-key--in" aria-hidden="true" />
								In <MoneyView minor={focused.inMinor} currency={currency} size="micro" />
							</span>
							<span class="wlt-chart__pair">
								<span class="wlt-key wlt-key--out" aria-hidden="true" />
								Out <MoneyView minor={focused.outMinor} currency={currency} size="micro" />
							</span>
						</>
					)
					: <span class="wlt-chart__hint">Over {periodPhrase(period)}</span>}
			</p>
			<table class="ui-visually-hidden">
				<caption>Money in and out over {periodPhrase(period)}</caption>
				<thead>
					<tr>
						<th scope="col">Period</th>
						<th scope="col">In</th>
						<th scope="col">Out</th>
					</tr>
				</thead>
				<tbody>
					{points.map((p, i) => (
						<tr key={`${p.label}-${i}`}>
							<th scope="row">{bucketName(period, p.label)}</th>
							<td>
								<MoneyView minor={p.inMinor} currency={currency} size="micro" />
							</td>
							<td>
								<MoneyView minor={p.outMinor} currency={currency} size="micro" />
							</td>
						</tr>
					))}
				</tbody>
			</table>
		</figure>
	);
}

/**
 * Money in against money out for the chosen window, summed server-side, with its trend. The window is
 * picked on the pinned range ruler; the heading names it so the section says which span it is showing
 * wherever the reader scrolled from.
 */
export function CashFlow(props: CashFlowProps): JSX.Element {
	const { activity, period } = props;
	return (
		<section class="wlt-section wlt-flow" id="cash-flow" aria-labelledby="wlt-flow-title">
			<header class="wlt-section__head">
				<h2 id="wlt-flow-title" class="wlt-section__title">
					Cash flow
					<span class="wlt-section__count">{windowLabel(period)}</span>
				</h2>
				{props.moreHref && (
					<a class="wlt-textlink" href={props.moreHref}>
						Analytics
						<Icon name="chevron-right" size="xs" class="wlt-mirror" />
					</a>
				)}
			</header>
			{activity
				? (
					<div
						class="wlt-flow__body"
						aria-busy={props.loading}
						data-loading={props.loading ? "true" : undefined}
					>
						<dl class="wlt-flow__totals">
							<div class="wlt-flow__total">
								<dt class="wlt-flow__term">
									<span class="wlt-key wlt-key--in" aria-hidden="true" />
									Money in
								</dt>
								<dd class="wlt-flow__figure">
									<MoneyView
										value={activity.totalIn}
										size="key"
										sign={activity.totalIn.minor > 0 ? "+" : undefined}
										tone={activity.totalIn.minor > 0 ? "credit" : "default"}
										hideOrigin
									/>
								</dd>
							</div>
							<div class="wlt-flow__total">
								<dt class="wlt-flow__term">
									<span class="wlt-key wlt-key--out" aria-hidden="true" />
									Money out
								</dt>
								<dd class="wlt-flow__figure">
									<MoneyView
										value={activity.totalOut}
										size="key"
										sign={activity.totalOut.minor > 0 ? "−" : undefined}
										hideOrigin
									/>
								</dd>
							</div>
							<div class="wlt-flow__total">
								<dt class="wlt-flow__term">Net</dt>
								<dd class="wlt-flow__figure">
									{activity.net.minor < 0
										? (
											<MoneyView
												minor={-activity.net.minor}
												currency={activity.net.currency}
												size="key"
												sign="−"
												hideOrigin
											/>
										)
										: <MoneyView value={activity.net} size="key" hideOrigin />}
								</dd>
							</div>
						</dl>
						<FlowChart
							points={activity.flow}
							currency={activity.totalIn.currency}
							period={period}
						/>
					</div>
				)
				: null}
			{props.error && (
				<InlineNotice
					text={props.error}
					actionLabel="Try again"
					onAction={props.onRetry}
					busy={props.loading}
					align="start"
					class="wlt-notice"
				/>
			)}
		</section>
	);
}
