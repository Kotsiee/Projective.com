import type { JSX } from "preact";
import { AreaChart, type AreaChartSeries, compactMoney } from "@projective/ui/display";
import { MoneyView } from "@projective/ui/display/money";
import { styleVars } from "@ui/core/style.ts";
import type { FlowPoint } from "../types/wallet-types.ts";

/** Props for {@link FlowAreaChart}. */
export interface FlowAreaChartProps {
	points: readonly FlowPoint[];
	currency: string;
	/** The window as a phrase ("the last 3 months"), for the accessible name and the table caption. */
	phrase: string;
	/** Whether a bucket spans more than a day, so its row reads "From 5 Oct". */
	spans: boolean;
	/** The series drawn (`in` · `out` · `net`); every one when absent. */
	show?: readonly string[];
}

/** Each series' ink, so a series keeps its colour when another is hidden (wallet-analytics.css). */
const SERIES_INK: Readonly<Record<string, string>> = {
	in: "var(--wlt-chart-in)",
	out: "var(--wlt-chart-out-ink)",
	net: "var(--wlt-chart-net)",
};

function Signed({ minor, currency }: { minor: number; currency: string }): JSX.Element {
	return minor < 0
		? <MoneyView minor={-minor} currency={currency} size="micro" sign="−" />
		: <MoneyView minor={minor} currency={currency} size="micro" />;
}

/**
 * Cash flow as the shared diverging {@link AreaChart}: money in rising above the zero baseline, money
 * out falling below it, and the net as a line across both — one axis, one unit. Every figure the
 * readout and the hidden table print is the server's own `MoneyView`; only the axis ticks are compact.
 */
export function FlowAreaChart(props: FlowAreaChartProps): JSX.Element {
	const { points, currency } = props;
	const all: AreaChartSeries[] = [
		{ id: "in", label: "Money in", shortLabel: "in", values: points.map((p) => p.inMinor) },
		{
			id: "out",
			label: "Money out",
			shortLabel: "out",
			values: points.map((p) => p.outMinor),
			invert: true,
		},
		{
			id: "net",
			label: "Net",
			shortLabel: "net",
			values: points.map((p) => p.netMinor),
			mark: "line",
		},
	];
	const series = props.show ? all.filter((s) => props.show!.includes(s.id)) : all;
	const chart = (
		<AreaChart
			class="wlt-area"
			caption={`Money in, money out and net over ${props.phrase}`}
			captionHidden
			labels={points.map((p) => p.label)}
			bucketName={(label) => (props.spans ? `From ${label}` : label)}
			series={series}
			formatValue={(value, s) =>
				s.id === "net"
					? <Signed minor={value} currency={currency} />
					: <MoneyView minor={value} currency={currency} size="micro" />}
			formatTick={(value) => compactMoney(value, currency)}
		/>
	);
	if (series.length === all.length) return chart;
	const inks = Object.fromEntries(series.map((s, i) => [`--wlt-area-${i + 1}`, SERIES_INK[s.id]]));
	return <div style={styleVars(inks)}>{chart}</div>;
}
