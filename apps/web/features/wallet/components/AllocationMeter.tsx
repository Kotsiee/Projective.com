import type { JSX } from "preact";
import { Tooltip } from "@projective/ui/feedback";
import { MoneyView } from "@projective/ui/display/money";
import { styleVars } from "@ui/core/style.ts";
import type {
	ActivityView,
	AllocationSlice,
	FundState,
	IncomingItem,
	LedgerKind,
	MoneyView as Money,
	WalletOverview,
	WalletSwitcher,
} from "../types/wallet-types.ts";
import { fundStateHint } from "../core/wallet-home.ts";
import {
	type FlowPeriod,
	fundStateLabel,
	ledgerKindLabel,
	periodPhrase,
	walletParam,
} from "../core/wallet-model.ts";
import { FundStateIcon } from "./wallet-glyphs.tsx";

/** Props for {@link AllocationMeter}. */
export interface AllocationMeterProps {
	/** The overview whose server-computed `allocation` the meter draws, and whose stages it names. */
	overview: WalletOverview;
	/** Every wallet the viewer can see, for the across-accounts row. */
	switcher: WalletSwitcher;
	/** The cash-flow window's activity, for a freelancer's earnings by line; `null` while it loads. */
	activity: ActivityView | null;
	period: FlowPeriod;
}

/** How many of a state's own items a detail popover lists before summarising the rest. */
const DETAIL_ITEMS = 3;

/** The line families a freelancer earns through: project stages, services and products. */
const EARNING_LINES: readonly LedgerKind[] = ["escrow_release", "service_sale", "product_sale"];

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
 * One key's two lines — the name over the figure; its item draws the vertical pill (`::before`) in the
 * segment's own fill. A key with a `detail` popover is a tab stop that opens it, above the key: below,
 * the popover would cover the very figure it explains.
 */
function Key(
	{ label, value, hint, detail }: {
		label: string;
		value: Money;
		hint?: string;
		detail?: JSX.Element;
	},
): JSX.Element {
	const term = <span class="wlt-alloc__term" tabIndex={detail ? 0 : undefined}>{label}</span>;
	return (
		<>
			<dt class="wlt-alloc__label">
				{detail
					? (
						<Tooltip content={detail} placement="top" class="wlt-alloc__tip">
							{term}
						</Tooltip>
					)
					: term}
				{hint && <span class="ui-visually-hidden">. {hint}</span>}
			</dt>
			<dd class="wlt-alloc__figure">
				<MoneyView value={value} size="body" hideOrigin />
			</dd>
		</>
	);
}

// #region Server-figure rows
/** One part of a secondary breakdown — every figure the server's own `MoneyView`. */
interface Part {
	key: string;
	label: string;
	value: Money;
}

interface Row {
	id: string;
	/** What the row divides, in the meta register: these rows are not the balance above them. */
	caption: string;
	parts: Part[];
}

/**
 * The rows under the fund-state meter, each only where this wallet has the figures and more than one
 * part holds something (a zero, or a figure in another currency than the page's, is left out):
 *
 * - **Across your accounts** — every wallet the viewer can see, by its Available (the switcher's own
 *   figures), so money held in a team or a business vault sits beside this one.
 * - **By member** — a team vault: its last release divided by each member's agreed stake, as the
 *   server previewed it; a business vault: what each member has spent against their envelope.
 * - **Earned by line** — a freelancer's own wallet: what the window brought in through project stages,
 *   services and products.
 *
 * Segment widths are display ratios of figures already shown; no total is computed or printed.
 */
function rowsOf(props: AllocationMeterProps): Row[] {
	const { overview: o, switcher, activity } = props;
	const currency = o.capital.currency;
	const active = walletParam(switcher.active.scope, switcher.active.id);
	const rows: Row[] = [
		{
			id: "accounts",
			caption: "Across your accounts",
			parts: switcher.accounts.map((a) => {
				const param = walletParam(a.scope, a.id);
				const name = a.scope === "personal" ? "Personal" : a.name;
				return {
					key: param,
					label: param === active ? `${name} (this wallet)` : name,
					value: a.available,
				};
			}),
		},
	];
	if (o.team) {
		rows.push({
			id: "members",
			caption: "Last release, split by member",
			parts: o.team.splitRule.previewShares.map((s) => ({
				key: s.handle ?? s.name,
				label: s.name,
				value: s.amount,
			})),
		});
	}
	if (o.business) {
		rows.push({
			id: "members",
			caption: "Spent by member",
			parts: o.business.caps.map((c) => ({ key: c.id, label: c.memberName, value: c.spent })),
		});
	}
	if (o.verification.subject === "freelancer" && o.ref.scope === "personal" && activity) {
		rows.push({
			id: "lines",
			caption: `Earned by line over ${periodPhrase(props.period)}`,
			parts: activity.byKind
				.filter((k) => EARNING_LINES.includes(k.kind))
				.map((k) => ({ key: k.kind, label: ledgerKindLabel(k.kind), value: k.amountIn })),
		});
	}
	return rows
		.map((row) => ({
			...row,
			parts: row.parts
				.filter((p) => p.value.minor > 0 && p.value.currency === currency)
				.sort((a, b) => b.value.minor - a.value.minor),
		}))
		.filter((row) => row.parts.length > 1);
}

/** A neutral shade per rank, darkest first, so a row's identity is its labels and never a hue. */
function shadeOf(rank: number): string {
	return `${Math.max(22, 86 - rank * 16)}%`;
}

function PartsRow({ row }: { row: Row }): JSX.Element {
	const whole = row.parts.reduce((sum, p) => sum + p.value.minor, 0);
	return (
		<div class="wlt-alloc__row" role="group" aria-labelledby={`wlt-alloc-${row.id}`}>
			<p id={`wlt-alloc-${row.id}`} class="wlt-alloc__caption">{row.caption}</p>
			<div class="wlt-alloc__bar" aria-hidden="true">
				{row.parts.map((part, rank) => (
					<div
						key={part.key}
						class="wlt-alloc__cell wlt-alloc__cell--part"
						style={styleVars({
							"--seg": `${(part.value.minor / whole) * 100}%`,
							"--wlt-shade": shadeOf(rank),
						})}
					>
						<span class="wlt-alloc__seg" />
					</div>
				))}
			</div>
			<dl class="wlt-alloc__legend">
				{row.parts.map((part, rank) => (
					<div
						key={part.key}
						class="wlt-alloc__item wlt-alloc__item--part"
						style={styleVars({ "--wlt-shade": shadeOf(rank) })}
					>
						<Key label={part.label} value={part.value} />
					</div>
				))}
			</dl>
		</div>
	);
}
// #endregion

/**
 * The balance breakdown at the head of the dashboard sheet: one track divided between what is
 * spendable, what is clearing its 7-day safety window, what is held in escrow and what is reserved —
 * after the balance summary bar a payments dashboard draws — with its keys centred beneath, each a
 * vertical pill in its segment's fill beside the state's name over its figure. Beneath it, where this
 * wallet has the figures, the same money seen across sources ({@link rowsOf}).
 *
 * **Every fund-state width is the server's.** Each segment is `flex: 0 0 var(--seg)` with `--seg` the
 * slice's `widthBp` from the overview (`allocationSlices`), the same four figures summed into the
 * total above it; nothing grows, shrinks or animates, so a frozen animation clock cannot draw a share
 * at a width it does not have. A slice under 1.5% is a SLIVER, drawn at a visible floor, and a state
 * holding nothing has no slice and no key.
 *
 * Pointing at a segment — or focusing its key — opens a popover with the figure, the share, what the
 * state means for this wallet and the stages or releases behind it. Identity never rides on colour
 * alone: clearing is hatched, every key carries its name, and the legend is a `<dl>` whose terms and
 * figures read in order without the track.
 */
export function AllocationMeter(props: AllocationMeterProps): JSX.Element {
	const { overview } = props;
	const slices = overview.allocation;
	return (
		<section class="wlt-section wlt-alloc" aria-label="Balance breakdown">
			{slices.length === 0
				? (
					<>
						<div class="wlt-alloc__bar wlt-alloc__bar--empty" aria-hidden="true" />
						<p class="wlt-alloc__empty">Nothing is held here yet.</p>
					</>
				)
				: (
					<div class="wlt-alloc__row">
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
								<div key={slice.state} class="wlt-alloc__item" data-state={slice.state}>
									<Key
										label={fundStateLabel(slice.state)}
										value={slice.value}
										hint={`${slice.percent}. ${fundStateHint(slice.state, overview)}`}
										detail={<SliceDetail slice={slice} overview={overview} />}
									/>
								</div>
							))}
						</dl>
					</div>
				)}
			{rowsOf(props).map((row) => <PartsRow key={row.id} row={row} />)}
		</section>
	);
}
