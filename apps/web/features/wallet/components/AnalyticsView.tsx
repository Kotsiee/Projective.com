import type { ComponentChildren, JSX } from "preact";
import { InlineNotice } from "@projective/ui/feedback";
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
	isElsewhere,
	ledgerKindLabel,
	periodPhrase,
} from "../core/wallet-model.ts";
import { releaseAxis } from "../core/chart-geometry.ts";
import { FlowAreaChart } from "./FlowAreaChart.tsx";

/** Props for {@link AnalyticsView}. */
export interface AnalyticsViewProps {
	period: FlowPeriod;
	activity: ActivityView | null;
	loading: boolean;
	error: string | null;
	onRetry: () => void;
	/** Whether the island has hydrated; relative dates are drawn against the browser's clock once known. */
	mounted: boolean;
}

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

/**
 * One region of the grid: a section header in the label register, `--space-7` above and `--space-3`
 * below, and its content — never a box. `span` is how many of the twelve columns it takes once the
 * page is wide enough to have columns at all.
 */
function Region(
	props: {
		id: string;
		title: string;
		meta?: string;
		span: 4 | 8 | 12;
		children: ComponentChildren;
	},
): JSX.Element {
	return (
		<section class="wlt-an__region" data-span={props.span} aria-labelledby={props.id}>
			<header class="wlt-an__head">
				<h2 id={props.id} class="wlt-an__title">{props.title}</h2>
				{props.meta && <span class="wlt-an__meta">{props.meta}</span>}
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
						{kpi.key === "net" && kpi.value.minor < 0
							? (
								// A negative net prints its true minus beside a positive figure, as Money out does —
								// never a hyphen from the formatter.
								<MoneyView
									minor={-kpi.value.minor}
									currency={kpi.value.currency}
									size="key"
									sign="−"
								/>
							)
							: (
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
	const axis = now !== null ? releaseAxis(items, now, 14, timeZone) : null;
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
							data-state={p.state}
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

/**
 * `/wallet/analytics` — an uncarded 12-column grid of regions (DESIGN_SYSTEM §B.4 / §B.9.7): a KPI strip
 * across the top; cash flow (8) beside the category volume (4); the release schedule (8) beside the top
 * projects (4). Regions are separated by asymmetric whitespace and ONE hairline per boundary — no region
 * is boxed, nothing is nested, and the columns collapse by CONTAINER width, not the viewport's, because
 * the lane and the panel decide how wide the canvas is. Every figure is the server's; the charts are the
 * same figures drawn, each with a readable twin.
 */
export function AnalyticsView(props: AnalyticsViewProps): JSX.Element {
	const a = props.activity;
	const phrase = periodPhrase(props.period);
	return (
		<div
			class="wlt-an"
			aria-busy={props.loading ? "true" : "false"}
			data-loading={props.loading ? "true" : undefined}
		>
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
					<Region id="wlt-an-flow" title="Cash flow" meta={`By ${a.grain}`} span={8}>
						<FlowAreaChart
							points={a.flow}
							currency={a.totalIn.currency}
							phrase={phrase}
							spans={a.grain !== "day"}
						/>
					</Region>
					<Region id="wlt-an-kinds" title="By category" span={4}>
						<KindBreakdown slices={a.byKind} phrase={phrase} />
					</Region>
					<Region
						id="wlt-an-releases"
						title="Release schedule"
						meta="Projected clearances"
						span={8}
					>
						<ReleaseTimeline items={a.releases} mounted={props.mounted} timeZone={a.timezone} />
					</Region>
					<Region id="wlt-an-projects" title="Top projects" meta="By allocation" span={4}>
						<TopProjects projects={a.topProjects} />
					</Region>
				</div>
			)}
			{!a && !props.error && (
				<p class="wlt-empty" role="status">
					<Icon name="analytics" size="sm" /> Loading your analytics…
				</p>
			)}
		</div>
	);
}
