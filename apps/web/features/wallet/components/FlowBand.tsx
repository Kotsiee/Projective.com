import type { JSX } from "preact";
import { useSignal } from "@preact/signals";
import { cx } from "@ui/core/cx.ts";
import { styleVars } from "@ui/core/style.ts";
import { Band, BandHead, EmptyBand } from "./band-parts.tsx";
import { Money } from "./Money.tsx";
import { buildFlow } from "../core/flow-chart.ts";
import { composeParts, groupLike, splitMinor } from "../core/money-format.ts";
import { currencyExponent } from "../types/wallet-types.ts";
import type { FlowPoint, FlowRange, MoneyView } from "../types/wallet-types.ts";
import "../styles/wallet-charts.css";

/**
 * FlowBand — band 2 of the wallet stack: money in versus money out (BUILD CONTRACT §4.3).
 *
 * The chart sits in `.wlt-band__bleed` so it reaches the true region edge. It carries **no**
 * `max-inline-size` anywhere: a chart the interface hedges about is a chart the user distrusts, and
 * the centred column is the single biggest thing this surface's architecture removes (§12.3).
 *
 * The mark is drawn as ONE inline `<svg>` stretched by `preserveAspectRatio="none"`, with every
 * readable element — the hover cursor, the peak dot, the axis labels — as a DOM sibling positioned in
 * PERCENTAGES over it. That split is deliberate: the geometry stays resolution-independent (the same
 * path is correct at 176px and at 1.4× on the Activity page) while text and dots never inherit the
 * horizontal distortion the stretch introduces.
 *
 * **The time axis is never mirrored under RtL.** A time axis reads left-to-right in every locale, so
 * the plot is direction-locked in `wallet-charts.css`; only the surrounding chrome — the band head,
 * its totals, the screen-reader table — flips (§11 RtL).
 *
 * Accessibility is redundant by construction: the SVG is `role="img"` with a summary that quotes the
 * SERVER's own totals, and the full series ships as a visually-hidden `<table>`. A chart no screen
 * reader can read is not accessible, and on a financial surface that is a custody failure, not a
 * polish item.
 */

// #region Constants
/**
 * The nominal coordinate space. The SVG stretches to whatever `--wlt-chart-h` and the content region
 * resolve to, so these are units of geometry, not pixels of layout.
 */
const VIEW_W = 1000;

/** Matches `--wlt-chart-h` (11rem). Only ever used as the geometry's block extent. */
const VIEW_H = 176;

const RANGE_LABEL: Record<FlowRange, string> = {
	"30d": "last 30 days",
	"60d": "last 60 days",
	"90d": "last 90 days",
};
// #endregion

// #region Bucket amounts
/**
 * Render one bucket's minor-unit value using a server-formatted amount as the template.
 *
 * `FlowPoint` carries only minor units — the server sends no per-bucket `MoneyView` — so the readout
 * borrows the symbol, grouping and suffix from a total the server DID format and substitutes the
 * major units, exactly as the hero's count-up does (RULE M-2 / G3). Integer major units only: pence
 * on a chart readout are noise, and re-deriving a locale's decimal rule on the client is how SSR and
 * the hydrated island drift apart. Returns `null` when no server-formatted sample exists, in which
 * case the readout omits the figure rather than inventing one (§12.5).
 */
function bucketText(minor: number, sample: MoneyView | null): string | null {
	if (!sample) return null;
	const parts = splitMinor(sample.display, sample.currency);
	const exp = currencyExponent(sample.currency);
	return composeParts(parts, groupLike(sample.display, Math.max(0, minor) / 10 ** exp), null);
}
// #endregion

// #region Component
export interface FlowBandProps {
	/** The in/out series, newest bucket last. */
	flow: FlowPoint[];
	/** The window the series covers — printed in the band head, chosen in the header band (§5.2). */
	range: FlowRange;
	/** Server-formatted period totals. Rendered verbatim; never summed here (RULE D-1). */
	totalIn?: MoneyView | null;
	totalOut?: MoneyView | null;
	net?: MoneyView | null;
	/**
	 * Overrides the rendered plot height. Left unset the height comes from `--wlt-chart-h`, so the
	 * responsive step down to `--wlt-chart-h-sm` still applies — an inline value would out-rank it.
	 */
	height?: number;
	/** Heading id, so one page can carry more than one flow band. */
	id?: string;
	/** Position in the band stack, driving the 40ms staggered entrance. Band 2 by default. */
	index?: number;
}

export function FlowBand(props: FlowBandProps): JSX.Element {
	const { flow, range, totalIn = null, totalOut = null, net = null } = props;
	const headId = props.id ?? "wlt-flow-head";
	const geo = buildFlow(flow, VIEW_W, VIEW_H);
	const mid = VIEW_H / 2;
	const count = flow.length;
	const flat = count === 0 || geo.maxMinor === 0;

	/** The hovered bucket index, or `null` at rest. A pointer enhancement — never the only channel. */
	const hover = useSignal<number | null>(null);

	const pointer = (event: JSX.TargetedPointerEvent<SVGSVGElement>): void => {
		if (count === 0) return;
		const box = event.currentTarget.getBoundingClientRect();
		if (box.width <= 0) return;
		// Physical client coordinates against a direction-locked plot: fraction 0 is always the
		// oldest bucket, in every locale.
		const fraction = (event.clientX - box.left) / box.width;
		const index = Math.round(fraction * Math.max(0, count - 1));
		hover.value = Math.min(count - 1, Math.max(0, index));
	};

	const active = hover.value === null ? null : flow[hover.value] ?? null;
	const cursorPct = count > 1 && hover.value !== null
		? `${(hover.value / (count - 1)) * 100}%`
		: "50%";

	const inSample = totalIn ?? net ?? totalOut;
	const outSample = totalOut ?? net ?? totalIn;
	const activeIn = active ? bucketText(active.inMinor, inSample) : null;
	const activeOut = active ? bucketText(active.outMinor, outSample) : null;
	// Joined as one string rather than as JSX fragments: significant leading whitespace between
	// sibling elements does not survive formatting, and a readout reading "Week 12· in £X" is a bug.
	const readout = active
		? [
			active.label,
			activeIn ? `in ${activeIn}` : null,
			activeOut ? `out ${activeOut}` : null,
		].filter(Boolean).join(" · ")
		: "";

	const summary = [
		`Money in versus money out, ${RANGE_LABEL[range]}, across ${count} periods.`,
		totalIn ? `In ${totalIn.display}.` : null,
		totalOut ? `Out ${totalOut.display}.` : null,
		net ? `Net ${net.display}.` : null,
	].filter(Boolean).join(" ");

	return (
		<Band tone="flow" index={props.index ?? 1} titleId={headId}>
			<BandHead
				id={headId}
				title={`Money in vs out · ${RANGE_LABEL[range]}`}
				meta={
					<>
						{totalIn && (
							<span>
								in <Money value={totalIn} />
							</span>
						)}
						{totalOut && (
							<span>
								out <Money value={totalOut} />
							</span>
						)}
						{net && (
							<span>
								net <Money value={net} tone="credit" />
							</span>
						)}
					</>
				}
			/>

			<div
				class={cx("wlt-chart", "wlt-chart--flow", "wlt-band__bleed")}
				style={props.height ? styleVars({ "--wlt-chart-h": `${props.height}px` }) : undefined}
			>
				<svg
					class="wlt-chart__svg"
					viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
					preserveAspectRatio="none"
					role="img"
					aria-label={summary}
					onPointerMove={pointer}
					onPointerLeave={() => (hover.value = null)}
					onPointerCancel={() => (hover.value = null)}
				>
					{/* The zero line — the one mark that survives an empty series (§9). */}
					<line class="wlt-chart__grid" x1={0} x2={VIEW_W} y1={mid} y2={mid} />
					{geo.outArea && <path class="wlt-chart__area wlt-chart__area--out" d={geo.outArea} />}
					{geo.inArea && <path class="wlt-chart__area wlt-chart__area--in" d={geo.inArea} />}
					{geo.netLine && (
						<path
							class="wlt-chart__line wlt-chart__line--net"
							d={geo.netLine}
							pathLength={1}
							fill="none"
						/>
					)}
				</svg>

				{geo.peak && (
					<div
						class="wlt-chart__peak"
						aria-hidden="true"
						style={styleVars({
							"--wlt-peak-x": `${(geo.peak.x / VIEW_W) * 100}%`,
							"--wlt-peak-y": `${(geo.peak.y / VIEW_H) * 100}%`,
						})}
					>
						<span class="wlt-chart__peak-dot" />
					</div>
				)}

				{active && (
					<div
						class="wlt-chart__cursor"
						aria-hidden="true"
						style={styleVars({ "--wlt-cursor-x": cursorPct })}
					>
						<span class="wlt-chart__peak-label wlt-num">{readout}</span>
					</div>
				)}

				{geo.ticks.length > 0 && (
					<div class="wlt-chart__axis" aria-hidden="true">
						{/* Keyed by position, not label: two buckets can legitimately share a label. */}
						{geo.ticks.map((tick) => (
							<span
								key={tick.x}
								class="wlt-chart__tick"
								style={styleVars({ "--wlt-tick-x": `${(tick.x / VIEW_W) * 100}%` })}
							>
								{tick.label}
							</span>
						))}
					</div>
				)}

				<table class="wlt-chart__table">
					<caption>Money in versus money out, {RANGE_LABEL[range]}</caption>
					<thead>
						<tr>
							<th scope="col">Period</th>
							{inSample && <th scope="col">In</th>}
							{outSample && <th scope="col">Out</th>}
						</tr>
					</thead>
					<tbody>
						{flow.map((point, i) => (
							<tr key={i}>
								<th scope="row">{point.label}</th>
								{inSample && <td>{bucketText(point.inMinor, inSample)}</td>}
								{outSample && <td>{bucketText(point.outMinor, outSample)}</td>}
							</tr>
						))}
					</tbody>
				</table>
			</div>

			{flat && <EmptyBand text="No movement yet" />}
		</Band>
	);
}
// #endregion
