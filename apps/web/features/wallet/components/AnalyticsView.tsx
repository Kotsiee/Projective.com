import type { ComponentChildren, JSX } from "preact";
import { useSignal } from "@preact/signals";
import "@web/features/projects/styles/fx-toolbar.css";
import { Dialog, InlineNotice, Tooltip } from "@projective/ui/feedback";
import { Select, SelectButton } from "@projective/ui/fields";
import { Icon } from "@projective/ui/icons";
import { MoneyView } from "@projective/ui/display/money";
import { styleVars } from "@ui/core/style.ts";
import type {
	ActivityView,
	KindSlice,
	MoneyView as Money,
	ProjectAllocation,
	ReleaseItem,
} from "../types/wallet-types.ts";
import {
	type FlowPeriod,
	hasTrend,
	isElsewhere,
	ledgerKindLabel,
	periodPhrase,
} from "../core/wallet-model.ts";
import { timeAxis } from "@projective/ui/display";
import { FlowAreaChart } from "./FlowAreaChart.tsx";

/** Props for {@link AnalyticsView}. */
export interface AnalyticsViewProps {
	/** The window on screen; the footer band's ruler picks it (`walletFooterFor`). */
	period: FlowPeriod;
	activity: ActivityView | null;
	loading: boolean;
	error: string | null;
	onRetry: () => void;
	/** Whether the island has hydrated; relative dates are drawn against the browser's clock once known. */
	mounted: boolean;
}

/** The charts the page draws, each with an inspector of its own. */
type Chart = "flow" | "kinds" | "releases" | "projects";

const CHART_TITLE: Readonly<Record<Chart, string>> = {
	flow: "Cash flow",
	kinds: "By category",
	releases: "Release schedule",
	projects: "Top projects",
};

const CHARTS = Object.keys(CHART_TITLE) as Chart[];

const SHOW_OPTIONS = [
	{ label: "All charts", value: "all" },
	...CHARTS.map((chart) => ({ label: CHART_TITLE[chart], value: chart })),
];

/** A share in basis points as the whole percent a reader compares, with `<1%` for a sliver. */
function percentOf(shareBp: number): string {
	if (shareBp <= 0) return "0%";
	if (shareBp < 100) return "<1%";
	return `${Math.round(shareBp / 100)}%`;
}

function capitalise(phrase: string): string {
	const text = phrase.replace(/^the /, "");
	return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Whether a chart has anything to inspect. */
function hasData(chart: Chart, a: ActivityView): boolean {
	if (chart === "flow") return hasTrend(a.flow);
	if (chart === "kinds") return a.byKind.length > 0;
	if (chart === "releases") return a.releases.length > 0;
	return a.topProjects.length > 0;
}

/**
 * One region of the grid: a section header in the label register — with the chart's inspect control
 * at its end, where the chart has something to inspect — and its content, never a box. `span` is how
 * many of the twelve columns it takes once the page is wide enough to have columns at all.
 */
function Region(
	props: {
		id: string;
		title: string;
		meta?: string;
		span: 4 | 8 | 12;
		onInspect?: () => void;
		children: ComponentChildren;
	},
): JSX.Element {
	return (
		<section class="wlt-an__region" data-span={props.span} aria-labelledby={props.id}>
			<header class="wlt-an__head">
				<h2 id={props.id} class="wlt-an__title">{props.title}</h2>
				{props.meta && <span class="wlt-an__meta">{props.meta}</span>}
				{props.onInspect && (
					<Tooltip content={`Inspect ${props.title.toLowerCase()}`}>
						<button
							type="button"
							class="wlt-iconbtn wlt-an__inspect"
							aria-label={`Inspect ${props.title.toLowerCase()}`}
							aria-haspopup="dialog"
							onClick={props.onInspect}
						>
							<Icon name="expand" size="sm" />
						</button>
					</Tooltip>
				)}
			</header>
			{props.children}
		</section>
	);
}

// #region KPI strip
interface Kpi {
	key: string;
	label: string;
	value: Money;
	sign?: "+" | "−";
	hint: string;
}

function kpisOf(a: ActivityView): Kpi[] {
	const kpis: Kpi[] = [
		{
			key: "in",
			label: "In",
			value: a.totalIn,
			sign: a.totalIn.minor > 0 ? "+" : undefined,
			hint: "Everything credited in the window",
		},
		{
			key: "out",
			label: "Out",
			value: a.totalOut,
			sign: a.totalOut.minor > 0 ? "−" : undefined,
			hint: "Everything debited in the window",
		},
		{ key: "net", label: "Net", value: a.net, hint: "In less out" },
	];
	if (a.lockedCapital) {
		kpis.push({
			key: "locked",
			label: "Locked capital",
			value: a.lockedCapital,
			hint: "Held in escrow on active stages now",
		});
	}
	if (a.projectedIncome) {
		kpis.push({
			key: "projected",
			label: "Projected income",
			value: a.projectedIncome,
			hint: "Escrow on your stages plus releases still clearing",
		});
	}
	return kpis;
}

/** A signed figure: a negative prints its true minus beside a positive figure, never a hyphen. */
function Signed({ value, size }: { value: Money; size: "key" | "body" }): JSX.Element {
	return value.minor < 0
		? <MoneyView minor={-value.minor} currency={value.currency} size={size} sign="−" />
		: <MoneyView value={value} size={size} hideOrigin />;
}

function KpiStrip({ activity }: { activity: ActivityView }): JSX.Element {
	return (
		<dl class="wlt-kpis">
			{kpisOf(activity).map((kpi) => (
				<div key={kpi.key} class="wlt-kpi" data-kpi={kpi.key}>
					<dt class="wlt-kpi__label">
						{kpi.label}
						<span class="ui-visually-hidden">. {kpi.hint}</span>
					</dt>
					<dd class="wlt-kpi__value">
						{kpi.key === "net" ? <Signed value={kpi.value} size="key" /> : (
							<MoneyView
								value={kpi.value}
								size="key"
								sign={kpi.sign}
								tone={kpi.key === "in" && kpi.sign ? "credit" : "default"}
								hideOrigin
							/>
						)}
					</dd>
				</div>
			))}
		</dl>
	);
}
// #endregion

// #region Not enough to draw
/**
 * In place of a chart that would flatline: a window with money moving in fewer than two of its
 * buckets draws a flat line or one spike, which reads as a trend it is not.
 */
function NoTrend({ phrase, grain }: { phrase: string; grain: string }): JSX.Element {
	return (
		<div class="wlt-notrend" role="status">
			<Icon name="analytics" size="md" class="wlt-notrend__icon" />
			<p class="wlt-notrend__title">Not enough activity to draw a trend</p>
			<p class="wlt-notrend__note">
				A trend needs money moving in at least two {grain}s of {phrase}. Try a longer window.
			</p>
		</div>
	);
}
// #endregion

// #region Category volume
function KindBreakdown(
	{ slices, phrase }: { slices: readonly KindSlice[]; phrase: string },
): JSX.Element {
	if (slices.length === 0) return <p class="wlt-empty">Nothing moved over {phrase}.</p>;
	return (
		<ul class="wlt-bars">
			{slices.map((slice) => (
				<li key={slice.kind} class="wlt-bars__row">
					<span class="wlt-bars__label">{ledgerKindLabel(slice.kind)}</span>
					<MoneyView value={slice.volume} size="body" hideOrigin class="wlt-bars__value" />
					<span class="wlt-bars__track" aria-hidden="true">
						<span
							class="wlt-bars__fill"
							style={styleVars({ "--wlt-share": Math.min(1, slice.shareBp / 10000) })}
						/>
					</span>
					<span class="wlt-bars__meta">
						{percentOf(slice.shareBp)}
						<span class="wlt-dot" aria-hidden="true">·</span>
						{slice.lines} {slice.lines === 1 ? "line" : "lines"}
						{slice.amountIn.minor > 0 && slice.amountOut.minor > 0 && (
							<>
								<span class="wlt-dot" aria-hidden="true">·</span>
								<MoneyView value={slice.amountIn} size="micro" hideOrigin /> in
							</>
						)}
					</span>
				</li>
			))}
		</ul>
	);
}
// #endregion

// #region Release schedule
const BASIS_NOTE: Readonly<Record<ReleaseItem["basis"], string>> = {
	clearing: "Clearing its 7-day window",
	stage_due: "Projected from the stage's due date",
	awaiting_approval: "Released when the work is approved",
};

function whenOf(item: ReleaseItem, now: number | null, timeZone: string): string {
	if (!item.at) return "No date yet";
	const at = Date.parse(item.at);
	const date = new Date(at).toLocaleDateString("en-GB", {
		day: "numeric",
		month: "short",
		timeZone,
	});
	if (now === null) return date;
	const days = Math.ceil((at - now) / 86_400_000);
	if (days <= 0) return `${date} · now`;
	return `${date} · in ${days} ${days === 1 ? "day" : "days"}`;
}

function ReleaseTimeline(
	{ items, mounted, timeZone }: {
		items: readonly ReleaseItem[];
		mounted: boolean;
		timeZone: string;
	},
): JSX.Element {
	if (items.length === 0) {
		return (
			<p class="wlt-empty">
				Nothing is waiting to clear. Escrow and releases will be scheduled here.
			</p>
		);
	}
	// The axis is measured from the browser's clock, so it is only drawn once the island knows it.
	const now = mounted ? Date.now() : null;
	const axis = now !== null ? timeAxis(items, now, 14, timeZone) : null;
	return (
		<div class="wlt-rel">
			{axis && axis.placed.length > 0 && (
				<div class="wlt-rel__axis" aria-hidden="true">
					<span class="wlt-rel__rule" />
					{axis.ticks.map((tick) => (
						<span
							key={tick.label}
							class="wlt-rel__tick"
							style={styleVars({ "--wlt-x": tick.ratio })}
						>
							{tick.label}
						</span>
					))}
					{axis.placed.map((p) => (
						<span
							key={p.id}
							class="wlt-rel__pip"
							data-state={p.item.state}
							style={styleVars({ "--wlt-x": p.ratio })}
						/>
					))}
				</div>
			)}
			<ol class="wlt-rel__list">
				{items.map((item) => (
					<li key={item.id} class="wlt-rel__row" data-state={item.state}>
						<span class="wlt-rel__mark" aria-hidden="true" />
						<span class="wlt-rel__body">
							{isElsewhere(item.href)
								? <a class="wlt-rel__name" href={item.href}>{item.label}</a>
								: <span class="wlt-rel__name">{item.label}</span>}
							<span class="wlt-rel__meta">{BASIS_NOTE[item.basis]}</span>
						</span>
						<span class="wlt-rel__trail">
							<MoneyView value={item.amount} size="body" hideOrigin />
							<span class="wlt-rel__when">{whenOf(item, now, timeZone)}</span>
						</span>
					</li>
				))}
			</ol>
		</div>
	);
}
// #endregion

// #region Top projects
function TopProjects({ projects }: { projects: readonly ProjectAllocation[] }): JSX.Element {
	if (projects.length === 0) {
		return <p class="wlt-empty">No capital is allocated to a project right now.</p>;
	}
	return (
		<ul class="wlt-bars">
			{projects.map((p) => (
				<li key={p.id} class="wlt-bars__row">
					{isElsewhere(p.href)
						? <a class="wlt-bars__label wlt-bars__label--link" href={p.href}>{p.name}</a>
						: <span class="wlt-bars__label">{p.name}</span>}
					<MoneyView
						value={p.allocated.minor > 0 ? p.allocated : p.moved}
						size="body"
						hideOrigin
						class="wlt-bars__value"
					/>
					<span class="wlt-bars__track" aria-hidden="true">
						<span
							class="wlt-bars__fill"
							style={styleVars({ "--wlt-share": Math.min(1, p.shareBp / 10000) })}
						/>
					</span>
					<span class="wlt-bars__meta">
						{p.allocated.minor > 0
							? (
								<>
									{percentOf(p.shareBp)}
									{p.held.minor > 0 && (
										<>
											<span class="wlt-dot" aria-hidden="true">·</span>
											<MoneyView value={p.held} size="micro" hideOrigin /> held
										</>
									)}
									{p.clearing.minor > 0 && (
										<>
											<span class="wlt-dot" aria-hidden="true">·</span>
											<MoneyView value={p.clearing} size="micro" hideOrigin /> clearing
										</>
									)}
								</>
							)
							: <>Moved in this window, nothing held</>}
					</span>
				</li>
			))}
		</ul>
	);
}
// #endregion

// #region Inspector
const SERIES_OPTIONS = [
	{ label: "Money in", value: "in" },
	{ label: "Money out", value: "out" },
	{ label: "Net", value: "net" },
];

const ORDER_OPTIONS = [
	{ label: "Largest first", value: "size" },
	{ label: "A–Z", value: "name" },
];

const STATE_OPTIONS = [
	{ label: "All", value: "all" },
	{ label: "Clearing", value: "pending" },
	{ label: "In escrow", value: "locked" },
];

/** One table of the inspector's side panel — every figure the server's own. */
function FactTable(
	{ caption, head, rows }: {
		caption: string;
		head: readonly string[];
		rows: readonly { key: string; cells: readonly ComponentChildren[] }[];
	},
): JSX.Element {
	return (
		<table class="wlt-inspect__table">
			<caption class="wlt-inspect__caption">{caption}</caption>
			<thead>
				<tr>{head.map((h) => <th key={h} scope="col">{h}</th>)}</tr>
			</thead>
			<tbody>
				{rows.map((row) => (
					<tr key={row.key}>
						{row.cells.map((cell, i) =>
							i === 0 ? <th key={i} scope="row">{cell}</th> : <td key={i}>{cell}</td>
						)}
					</tr>
				))}
			</tbody>
		</table>
	);
}

function money(value: Money): JSX.Element {
	return <MoneyView value={value} size="micro" hideOrigin />;
}

/** A bucket's figure; a negative net prints its true minus. */
function minor(amount: number, currency: string): JSX.Element {
	return amount < 0
		? <MoneyView minor={-amount} currency={currency} size="micro" sign="−" />
		: <MoneyView minor={amount} currency={currency} size="micro" />;
}

/**
 * One chart, inspected: the media and document inspectors' split — the chart drawn large on the left,
 * its figures and the controls that re-cut it on the right. The controls only re-draw what the server
 * already sent (which series, which order, which releases); nothing is recomputed. Remounted per
 * opening (`key`), so every inspection starts on the chart as the page shows it.
 */
function ChartInspector(
	{ chart, activity: a, phrase, mounted }: {
		chart: Chart;
		activity: ActivityView;
		phrase: string;
		mounted: boolean;
	},
): JSX.Element {
	const series = useSignal<string[]>(SERIES_OPTIONS.map((o) => o.value));
	const order = useSignal("size");
	const state = useSignal("all");
	const byName = order.value === "name";

	let stage: JSX.Element;
	let lens: JSX.Element;
	let facts: JSX.Element;

	if (chart === "flow") {
		stage = series.value.length > 0
			? (
				<FlowAreaChart
					points={a.flow}
					currency={a.totalIn.currency}
					phrase={phrase}
					spans={a.grain !== "day"}
					show={series.value}
				/>
			)
			: <p class="wlt-empty">Choose at least one series to draw.</p>;
		lens = <SelectButton multiple aria-label="Series" options={SERIES_OPTIONS} value={series} />;
		facts = (
			<>
				<KpiStrip activity={a} />
				<FactTable
					caption={`Each ${a.grain} money moved`}
					head={["From", "In", "Out", "Net"]}
					rows={a.flow.filter((p) => p.inMinor > 0 || p.outMinor > 0).map((p) => ({
						key: p.start,
						cells: [
							p.label,
							minor(p.inMinor, a.totalIn.currency),
							minor(p.outMinor, a.totalIn.currency),
							minor(p.netMinor, a.totalIn.currency),
						],
					}))}
				/>
			</>
		);
	} else if (chart === "kinds") {
		const slices = byName
			? [...a.byKind].sort((x, y) => ledgerKindLabel(x.kind).localeCompare(ledgerKindLabel(y.kind)))
			: a.byKind;
		stage = <KindBreakdown slices={slices} phrase={phrase} />;
		lens = <SelectButton aria-label="Order" options={ORDER_OPTIONS} value={order} />;
		facts = (
			<FactTable
				caption="Each category, both ways"
				head={["Category", "In", "Out", "Lines"]}
				rows={slices.map((s) => ({
					key: s.kind,
					cells: [ledgerKindLabel(s.kind), money(s.amountIn), money(s.amountOut), s.lines],
				}))}
			/>
		);
	} else if (chart === "releases") {
		const items = state.value === "all"
			? a.releases
			: a.releases.filter((r) => r.state === state.value);
		stage = items.length > 0
			? <ReleaseTimeline items={items} mounted={mounted} timeZone={a.timezone} />
			: <p class="wlt-empty">Nothing in this state is waiting to clear.</p>;
		lens = <SelectButton aria-label="Show" options={STATE_OPTIONS} value={state} />;
		facts = (
			<FactTable
				caption="Why each release is dated"
				head={["Basis", "Releases"]}
				rows={(Object.keys(BASIS_NOTE) as ReleaseItem["basis"][])
					.map((basis) => ({ basis, count: items.filter((r) => r.basis === basis).length }))
					.filter((row) => row.count > 0)
					.map((row) => ({ key: row.basis, cells: [BASIS_NOTE[row.basis], row.count] }))}
			/>
		);
	} else {
		const projects = byName
			? [...a.topProjects].sort((x, y) => x.name.localeCompare(y.name))
			: a.topProjects;
		stage = <TopProjects projects={projects} />;
		lens = <SelectButton aria-label="Order" options={ORDER_OPTIONS} value={order} />;
		facts = (
			<FactTable
				caption="Where each project's money stands"
				head={["Project", "Held", "Clearing", "Moved"]}
				rows={projects.map((p) => ({
					key: p.id,
					cells: [p.name, money(p.held), money(p.clearing), money(p.moved)],
				}))}
			/>
		);
	}

	return (
		<div class="wlt-inspect">
			<div class="wlt-inspect__stage">{stage}</div>
			<aside class="wlt-inspect__aside" aria-label={`${CHART_TITLE[chart]} details`}>
				<p class="wlt-inspect__window">{capitalise(phrase)}</p>
				<div class="wlt-inspect__lens">{lens}</div>
				{facts}
			</aside>
		</div>
	);
}
// #endregion

/**
 * `/wallet/analytics` — an uncarded 12-column grid of regions (DESIGN_SYSTEM §B.4 / §B.9.7) under the
 * shared `.fx-toolbar` holding which charts to show; the window is the footer band's ruler. A KPI strip across the top; cash flow (8) beside the category volume (4); the release schedule
 * (8) beside the top projects (4). Regions are separated by generous asymmetric whitespace and ONE
 * hairline per boundary — no region is boxed, nothing is nested, and the columns collapse by CONTAINER
 * width, not the viewport's, because the lane and the panel decide how wide the canvas is.
 *
 * Every figure is the server's; the charts are the same figures drawn, each with a readable twin. A
 * window too quiet to draw a trend says so rather than flatlining, and every chart with something to
 * show opens in an inspector ({@link ChartInspector}).
 */
export function AnalyticsView(props: AnalyticsViewProps): JSX.Element {
	const a = props.activity;
	const phrase = periodPhrase(props.period);
	const show = useSignal("all");
	const inspecting = useSignal(false);
	const chart = useSignal<Chart>("flow");
	const opened = useSignal(0);
	const shows = (c: Chart) => show.value === "all" || show.value === c;
	const inspect = (c: Chart) =>
		a && hasData(c, a)
			? () => {
				chart.value = c;
				opened.value += 1;
				inspecting.value = true;
			}
			: undefined;

	return (
		<div
			class="wlt-an"
			aria-busy={props.loading ? "true" : "false"}
			data-loading={props.loading ? "true" : undefined}
		>
			<div class="fx-toolbar wlt-an__toolbar" role="group" aria-label="Analytics view">
				<span class="fx-toolbar__spacer" />
				<Select
					class="ui-field--bare wlt-an__show"
					size="sm"
					aria-label="Show"
					options={SHOW_OPTIONS}
					value={show}
				/>
			</div>
			{props.error && (
				<InlineNotice
					text={props.error}
					actionLabel="Try again"
					onAction={props.onRetry}
					busy={props.loading}
					align="start"
					class="wlt-an__notice"
				/>
			)}
			{a && (
				<div class="wlt-an__grid">
					<Region id="wlt-an-kpis" title="Summary" meta={capitalise(phrase)} span={12}>
						<KpiStrip activity={a} />
					</Region>
					{shows("flow") && (
						<Region
							id="wlt-an-flow"
							title={CHART_TITLE.flow}
							meta={`By ${a.grain}`}
							span={show.value === "all" ? 8 : 12}
							onInspect={inspect("flow")}
						>
							{hasTrend(a.flow)
								? (
									<FlowAreaChart
										points={a.flow}
										currency={a.totalIn.currency}
										phrase={phrase}
										spans={a.grain !== "day"}
									/>
								)
								: <NoTrend phrase={phrase} grain={a.grain} />}
						</Region>
					)}
					{shows("kinds") && (
						<Region
							id="wlt-an-kinds"
							title={CHART_TITLE.kinds}
							span={show.value === "all" ? 4 : 12}
							onInspect={inspect("kinds")}
						>
							<KindBreakdown slices={a.byKind} phrase={phrase} />
						</Region>
					)}
					{shows("releases") && (
						<Region
							id="wlt-an-releases"
							title={CHART_TITLE.releases}
							meta="Projected clearances"
							span={show.value === "all" ? 8 : 12}
							onInspect={inspect("releases")}
						>
							<ReleaseTimeline items={a.releases} mounted={props.mounted} timeZone={a.timezone} />
						</Region>
					)}
					{shows("projects") && (
						<Region
							id="wlt-an-projects"
							title={CHART_TITLE.projects}
							meta="By allocation"
							span={show.value === "all" ? 4 : 12}
							onInspect={inspect("projects")}
						>
							<TopProjects projects={a.topProjects} />
						</Region>
					)}
				</div>
			)}
			{!a && !props.error && (
				<p class="wlt-empty" role="status">
					<Icon name="analytics" size="sm" /> Loading your analytics…
				</p>
			)}
			{a && (
				<Dialog
					visible={inspecting}
					header={CHART_TITLE[chart.value]}
					width="var(--overlay-w-xl)"
					class="wlt-inspect-dlg"
				>
					<ChartInspector
						key={opened.value}
						chart={chart.value}
						activity={a}
						phrase={phrase}
						mounted={props.mounted}
					/>
				</Dialog>
			)}
		</div>
	);
}
