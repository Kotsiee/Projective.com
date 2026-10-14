import type { ComponentChildren, JSX } from "preact";
import { useEffect, useRef } from "preact/hooks";
import { useSignal } from "@preact/signals";
import "../../styles/analytics.css";
import { AreaChart, FunnelChart, HeatmapGrid } from "@projective/ui/display";
import { SelectButton } from "@projective/ui/fields";
import { InlineNotice } from "@projective/ui/feedback";
import { catalogueSim, subscribeDevSeam } from "@web/utils/dev-seam.ts";
import { CatalogueService } from "../../core/CatalogueService.ts";
import {
	analyticsKey,
	analyticsQuery,
	type AnalyticsTarget,
	asOfCaption,
	countLabel,
	funnelSentence,
	moneyTick,
	periodOptions,
	periodPhrase,
	RATE_MIN_FUNNEL_NOTE,
	showsHeatmap,
	toChurn,
	toFunnel,
	toHeatmap,
	toKeywords,
	toRevenue,
	toTiles,
	toTopListings,
} from "../../core/analytics-view.ts";
import {
	AnalyticsPeriod,
	type CatalogueAnalytics,
	money,
	workspaceHref,
} from "../../types/catalogue-types.ts";
import { AnalyticsTiles } from "./AnalyticsTiles.tsx";
import { KeywordTable, TopListingsTable } from "./AnalyticsTables.tsx";
import { AnalyticsSkeleton } from "./AnalyticsSkeleton.tsx";

/**
 * AnalyticsCanvas — the one analytics surface for both scopes (plan §4.7): the console's
 * `?view=analytics` over a console scope, and the workspace's `?tab=analytics` over one listing.
 *
 * It reads `/api/catalogue/analytics` itself after first paint (the SSR stays light). While a read is
 * in flight it shows skeletons; a failed read shows why and a Retry, and NEVER the previous window's
 * figures or zeros — "nothing happened" is a claim about the seller's business, and a false one when
 * the truth is that it could not be read. Regions are separated by spacing on `--bg`; only the chart
 * plots sit on `--surface-1`.
 */

// #region State
type Load =
	| { status: "loading"; key: string }
	| { status: "error"; key: string; message: string }
	| { status: "ready"; key: string; data: CatalogueAnalytics };

const FAILED = "We couldn't load these analytics just now.";
// #endregion

// #region Region
function Region(props: {
	id: string;
	title: string;
	meta?: string | null;
	wide?: boolean;
	children: ComponentChildren;
}): JSX.Element {
	return (
		<section
			class="cat-an__region"
			data-wide={props.wide ? "true" : undefined}
			aria-labelledby={props.id}
		>
			<header class="cat-an__head">
				<h2 id={props.id} class="cat-an__title">{props.title}</h2>
				{props.meta && <span class="cat-an__meta">{props.meta}</span>}
			</header>
			{props.children}
		</section>
	);
}
// #endregion

// #region Body
function AnalyticsBody(
	{ data, idBase }: { data: CatalogueAnalytics; idBase: string },
): JSX.Element {
	const revenue = toRevenue(data.revenue, data.bucket);
	const funnel = toFunnel(data.funnel);
	const heat = showsHeatmap(data) ? toHeatmap(data.heatmap) : null;
	const keywords = toKeywords(data.keywords);
	const consoleScope = data.scope.kind === "catalogue";
	const top = consoleScope
		? toTopListings(
			data.topListings,
			(slug) => workspaceHref(slug, { tab: "analytics", period: data.period }),
		)
		: [];
	const id = (name: string) => `${idBase}-${name}`;

	return (
		<>
			<AnalyticsTiles tiles={toTiles(data)} churn={toChurn(data)} />
			<div class="cat-an__regions">
				<Region
					id={id("revenue")}
					title="Revenue velocity"
					meta={`${data.window.label} · ${data.currency}`}
					wide
				>
					{revenue.any
						? (
							<div class="cat-an__plot">
								<AreaChart
									caption={`Gross volume per ${data.bucket}, ${data.window.label}`}
									captionHidden
									labels={revenue.labels}
									bucketName={(_, i) => revenue.names[i]}
									bucketHeader={data.bucket === "week" ? "Week" : "Day"}
									series={[{ id: "gross", label: "Gross volume", values: revenue.values }]}
									formatValue={(v) => money(v, data.currency)}
									formatTick={(v) => moneyTick(v, data.currency)}
									hint="Use the arrow keys to move between buckets"
								/>
							</div>
						)
						: (
							<p class="cat-an__empty">
								Nothing sold in the last {periodPhrase(data.period)}.
							</p>
						)}
				</Region>

				<Region id={id("funnel")} title="From impression to order">
					{funnel.sufficient
						? (
							<div class="cat-an__plot">
								<FunnelChart
									caption="Impressions, views, checkout starts and orders"
									captionHidden
									steps={funnel.steps}
									formatValue={countLabel}
								/>
							</div>
						)
						: (
							<p class="cat-an__empty">
								{funnel.any ? funnelSentence(funnel) : "No impressions in this window yet."}
								<span class="cat-an__note">{RATE_MIN_FUNNEL_NOTE}</span>
							</p>
						)}
				</Region>

				{heat && (
					<Region
						id={id("heatmap")}
						title="When buyers book"
						meta={heat.peak
							? `Busiest ${heat.peak.day} ${heat.peak.hour} · ${data.timezone}`
							: data.timezone}
					>
						{heat.total > 0
							? (
								<div class="cat-an__heat">
									<HeatmapGrid
										caption={`Booked session starts by weekday and hour, ${data.timezone}`}
										captionHidden
										rows={heat.rows}
										columns={heat.columns}
										values={heat.values}
										columnLabelEvery={3}
										formatValue={(v) => `${countLabel(v)} ${v === 1 ? "booking" : "bookings"}`}
										rowHeader="Day"
									/>
								</div>
							)
							: <p class="cat-an__empty">No sessions were booked in this window.</p>}
					</Region>
				)}

				<Region id={id("keywords")} title="Searches you appeared in" wide={!heat}>
					<KeywordTable rows={keywords} />
				</Region>

				{consoleScope && (
					<Region id={id("top")} title="Top listings" meta="By gross volume" wide>
						<TopListingsTable rows={top} />
					</Region>
				)}
			</div>
		</>
	);
}
// #endregion

// #region Canvas
/** Props for {@link AnalyticsCanvas}. */
export interface AnalyticsCanvasProps {
	/** What the canvas covers. */
	target: AnalyticsTarget;
	/** The window, from the URL (`?period=`). */
	period: AnalyticsPeriod;
	/** Write a new window back to the URL; the canvas re-reads from the next `period`. */
	onPeriod: (period: AnalyticsPeriod) => void;
	/** A prefix for the region heading ids, unique on the page. */
	idBase?: string;
}

/** The dual-scope analytics canvas. */
export function AnalyticsCanvas(props: AnalyticsCanvasProps): JSX.Element {
	const key = analyticsKey(props.target, props.period);
	const load = useSignal<Load>({ status: "loading", key });
	const seq = useRef(0);
	const latest = useRef({ target: props.target, period: props.period });
	latest.current = { target: props.target, period: props.period };

	const read = async () => {
		const mine = ++seq.current;
		const { target, period } = latest.current;
		const at = analyticsKey(target, period);
		load.value = { status: "loading", key: at };
		const res = await CatalogueService.analytics(
			analyticsQuery(target, period, catalogueSim("catalogueAnalytics")),
		);
		if (mine !== seq.current) return;
		load.value = res.ok && res.data
			? { status: "ready", key: at, data: res.data }
			: { status: "error", key: at, message: res.message ?? FAILED };
	};

	useEffect(() => {
		void read();
	}, [key]);

	useEffect(() => subscribeDevSeam(() => void read()), []);

	const current = load.value;
	// A read for a window the URL has already left is never painted, not even for a frame.
	const state = current.key === key ? current : { status: "loading" as const, key };
	const idBase = props.idBase ?? "cat-an";

	return (
		<div class="cat-an" data-state={state.status} aria-busy={state.status === "loading"}>
			<div class="cat-an__bar">
				<SelectButton
					class="cat-an__period"
					aria-label="Analytics window"
					options={periodOptions()}
					value={props.period}
					onValueChange={(v) => {
						const next = AnalyticsPeriod.safeParse(v);
						if (next.success && next.data !== props.period) props.onPeriod(next.data);
					}}
				/>
				{state.status === "ready" && <p class="cat-an__asof">{asOfCaption(state.data.asOf)}</p>}
			</div>
			{state.status === "loading" && (
				<>
					<p class="ui-visually-hidden" role="status">Loading analytics</p>
					<AnalyticsSkeleton regions={props.target.kind === "catalogue" ? 4 : 3} />
				</>
			)}
			{state.status === "error" && (
				<InlineNotice
					class="cat-an__error"
					text={state.message}
					actionLabel="Retry"
					onAction={() => void read()}
					assertive
					align="start"
				/>
			)}
			{state.status === "ready" && <AnalyticsBody data={state.data} idBase={idBase} />}
		</div>
	);
}
// #endregion
