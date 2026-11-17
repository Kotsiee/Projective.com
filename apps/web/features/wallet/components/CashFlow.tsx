import type { JSX } from "preact";
import { useSignal } from "@preact/signals";
import { InlineNotice } from "@projective/ui/feedback";
import { Icon } from "@projective/ui/icons";
import { MoneyView } from "@projective/ui/display/money";
import type { ActivityView, MoneyView as Money } from "../types/wallet-types.ts";
import { type FlowPeriod, periodPhrase } from "../core/wallet-model.ts";
import { FlowAreaChart } from "./FlowAreaChart.tsx";

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

/** The window phrase as a heading's meta: "Last 3 months", "All time". */
export function windowLabel(period: FlowPeriod): string {
	const phrase = periodPhrase(period).replace(/^the /, "");
	return phrase.charAt(0).toUpperCase() + phrase.slice(1);
}

function Figure(
	{ minor, currency, sign, tone }: {
		minor: number;
		currency: string;
		sign?: "+" | "−";
		tone?: "credit" | "default";
	},
): JSX.Element {
	return <MoneyView minor={minor} currency={currency} size="key" sign={sign} tone={tone} hideOrigin />;
}

function Net({ value }: { value: Money }): JSX.Element {
	return value.minor < 0
		? <Figure minor={-value.minor} currency={value.currency} sign="−" />
		: <MoneyView value={value} size="key" hideOrigin />;
}

/**
 * The cash-flow header's live readout: the window's server totals — In · Out · Net — at rest, under a
 * hint to scrub, and the focused bucket's own figures while the crosshair is on one (pointer, touch or
 * the arrow keys), with the bucket named above them. The figures keep their places and `tabular-nums`, so scrubbing moves
 * no layout. Announced politely, as the chart's own readout is.
 */
export function FlowReadout(
	{ activity: a, index }: { activity: ActivityView; index: number | null },
): JSX.Element {
	const point = index !== null ? a.flow[index] ?? null : null;
	const currency = a.totalIn.currency;
	const when = point
		? (a.grain === "day" ? point.label : `From ${point.label}`)
		: `Totals · point at the chart to read each ${a.grain}`;
	const inMinor = point ? point.inMinor : a.totalIn.minor;
	const outMinor = point ? point.outMinor : a.totalOut.minor;
	return (
		<div class="wlt-flow__readout" aria-live="polite" data-scrubbing={point ? "true" : undefined}>
			<p class="wlt-flow__when">{when}</p>
			<dl class="wlt-flow__totals">
				<div class="wlt-flow__total">
					<dt class="wlt-flow__term">
						<span class="wlt-key wlt-key--in" aria-hidden="true" />
						In
					</dt>
					<dd class="wlt-flow__figure">
						{point
							? (
								<Figure
									minor={inMinor}
									currency={currency}
									sign={inMinor > 0 ? "+" : undefined}
									tone={inMinor > 0 ? "credit" : "default"}
								/>
							)
							: (
								<MoneyView
									value={a.totalIn}
									size="key"
									sign={inMinor > 0 ? "+" : undefined}
									tone={inMinor > 0 ? "credit" : "default"}
									hideOrigin
								/>
							)}
					</dd>
				</div>
				<div class="wlt-flow__total">
					<dt class="wlt-flow__term">
						<span class="wlt-key wlt-key--out" aria-hidden="true" />
						Out
					</dt>
					<dd class="wlt-flow__figure">
						{point
							? <Figure minor={outMinor} currency={currency} sign={outMinor > 0 ? "−" : undefined} />
							: (
								<MoneyView
									value={a.totalOut}
									size="key"
									sign={outMinor > 0 ? "−" : undefined}
									hideOrigin
								/>
							)}
					</dd>
				</div>
				<div class="wlt-flow__total">
					<dt class="wlt-flow__term">
						<span class="wlt-key wlt-key--net" aria-hidden="true" />
						Net
					</dt>
					<dd class="wlt-flow__figure">
						{point
							? (point.netMinor < 0
								? <Figure minor={-point.netMinor} currency={currency} sign="−" />
								: <Figure minor={point.netMinor} currency={currency} />)
							: <Net value={a.net} />}
					</dd>
				</div>
			</dl>
		</div>
	);
}

/** What the empty frame says when nothing moved in the window. */
export function QuietWindow({ period, hint }: { period: FlowPeriod; hint: string }): JSX.Element {
	return (
		<>
			<span class="wlt-quiet__title">No cash movement in this window</span>
			<span class="wlt-quiet__hint">
				Nothing moved in or out over {periodPhrase(period)}. {hint}
			</span>
		</>
	);
}

/**
 * Money in against money out for the chosen window, summed server-side, drawn as the shared diverging
 * area chart — in above the baseline, out below, net as a line — under a live header readout. The
 * window is picked on the pinned range ruler; the heading names it so the section says which span it
 * is showing wherever the reader scrolled from. A window in which nothing moved keeps its frame: the
 * gridlines, the baseline and the dates, with a sentence over them.
 */
export function CashFlow(props: CashFlowProps): JSX.Element {
	const { activity, period } = props;
	const active = useSignal<number | null>(null);
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
						<FlowReadout activity={activity} index={active.value} />
						<FlowAreaChart
							points={activity.flow}
							currency={activity.totalIn.currency}
							phrase={periodPhrase(period)}
							spans={activity.grain !== "day"}
							readout="none"
							onActiveChange={(index) => (active.value = index)}
							empty={<QuietWindow period={period} hint="Try a longer window on the ruler above." />}
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
