import type { JSX, VNode } from "preact";
import { useSignal } from "@preact/signals";
import "../styles/money-flow-popover.css";
import { cx } from "../../core/cx.ts";
import { styleVars } from "../../core/style.ts";
import { DraggablePopover } from "./DraggablePopover.tsx";
import type { PopoverPosition, PopoverSize } from "./DraggablePopover.tsx";
import { Button } from "../../fields/components/Button.tsx";
import { Icon } from "../../icons/mod.ts";
import type { IconName } from "../../icons/mod.ts";
import { useId } from "../../hooks/useId.ts";
import type { Bindable } from "../../fields/types/mod.ts";

// #region Data contract
/**
 * A money figure as it crosses into this component: integer minor units for **geometry and
 * comparison only**, plus the string the SERVER already rendered.
 *
 * `display` is the only member that is ever drawn. `minor` exists so the meter can lay out a rail
 * and so a before/after can state a *direction*; it is never formatted, summed into a shown figure,
 * converted, or rounded here. This package performs no money arithmetic — that is the fat service's
 * job, and two implementations of the same arithmetic eventually disagree about money.
 */
export interface FlowMoney {
	/** Integer minor units (pence/cents). Layout + sign channel only — never rendered. */
	minor: number;
	/** ISO-4217 code, used to build spoken labels. */
	currency: string;
	/** The server-rendered display string. The single thing this component prints. */
	display: string;
}

/** Which kind of principal a wallet or the active debugging scope belongs to. */
export type FlowScopeKind = "user" | "team" | "business";

/** The principal the debugger is currently bound to. */
export interface FlowScope {
	kind: FlowScopeKind;
	/** Opaque identifier — echoed back on {@link MoneyFlowPopoverProps.onScopeChange}. */
	id: string;
	/** Human name shown in the scope strip. */
	label: string;
	/** Optional `@handle`, shown as secondary identity. */
	handle?: string | null;
}

/** The part a wallet plays in the flow being traced. Drives its tag, not its behaviour. */
export type FlowWalletRole = "acting" | "counterparty" | "platform" | "escrow";

/** The four states capital can be in on one wallet. */
export type FlowBalanceBucket = "available" | "escrow" | "pending" | "projected";

/**
 * One wallet's four-state balance snapshot.
 *
 * `available`/`escrow`/`pending` are the three states money is actually *in* and together make up
 * the wallet's capital. `projected` is a **forecast**, not capital — it is drawn as a marker
 * against the same denominator rather than as a fourth slice, because a forecast summed into a
 * 100% capital rail would state something untrue.
 */
export interface FlowBalances {
	/** Spendable now. */
	available: FlowMoney;
	/** Locked in escrow against funded stages. */
	escrow: FlowMoney;
	/** Released but still inside the clearing window. */
	pending: FlowMoney;
	/** Forecast payout once the pipeline settles. */
	projected: FlowMoney;
	/**
	 * Server-summed capital (`available + escrow + pending`), used as the meter's denominator.
	 * Supply it whenever the service can: omitted, the component falls back to summing the three
	 * `minor` fields **for rail geometry only**, and that sum is never printed.
	 */
	capital?: FlowMoney | null;
}

/** A wallet the debugger can read and target. */
export interface FlowWallet {
	/** Opaque identifier — echoed back on every callback. */
	id: string;
	label: string;
	scope: FlowScopeKind;
	role?: FlowWalletRole;
	currency: string;
	/** Current balances. */
	balances: FlowBalances;
	/**
	 * Server-computed balances **after** the pending simulation, for the before/after preview.
	 * `null`/omitted renders "no pending simulation" rather than a fabricated projection.
	 */
	preview?: FlowBalances | null;
	/** Free-text operator note (e.g. "seller — KYC unverified"). */
	note?: string | null;
}

/** The kind of movement one trace leg represents. */
export type FlowLegKind = "debit" | "credit" | "hold" | "release" | "fee" | "split";

/**
 * One ordered leg of a simulated transaction — the whole point of the debugger is seeing that a
 * charge became a hold, became a release, became a fee and a set of splits, and where each landed.
 */
export interface FlowLeg {
	id: string;
	/** 1-based position in the trace, as the service ordered it. */
	seq: number;
	kind: FlowLegKind;
	/** What this leg did, in the service's words. */
	label: string;
	walletId: string;
	walletLabel: string;
	/** The amount moved. */
	amount: FlowMoney;
	/** The wallet's resulting balance after the leg — server-computed. */
	balanceAfter: FlowMoney;
	/** ISO timestamp or a pre-formatted stamp; rendered verbatim. */
	at?: string | null;
	note?: string | null;
	/** A leg the service refused or rolled back. */
	failed?: boolean;
}

/** The stages a simulated purchase can be driven through. */
export type FlowStage = "purchase" | "lock_escrow" | "release" | "disburse";

/** Intent emitted when the operator runs a simulation. Carries no arithmetic. */
export interface FlowSimulateRequest {
	scope: FlowScope;
	sourceWalletId: string;
	/** The seller/provider wallet, when the selected stages need one. */
	targetWalletId: string | null;
	/** Exactly what was typed, in MINOR units. The service does every calculation. */
	amountMinor: number;
	currency: string;
	/** Ordered, de-duplicated stages to run. */
	stages: FlowStage[];
}

/** Intent emitted when the operator overrides a balance bucket. */
export interface FlowSetBalanceRequest {
	walletId: string;
	/** Which bucket to write. `projected` is a forecast and is deliberately not writable. */
	bucket: Exclude<FlowBalanceBucket, "projected">;
	/** The new value in MINOR units. */
	amountMinor: number;
	currency: string;
}
// #endregion

// #region Props
/** Props for {@link MoneyFlowPopover}. */
export interface MoneyFlowPopoverProps {
	/** Controlled/uncontrolled open state, forwarded to {@link DraggablePopover}. */
	open: Bindable<boolean>;
	/** Fired whenever the open state changes. */
	onOpenChange?: (open: boolean) => void;
	/** Window title. Defaults to `"Money Flow"`. */
	title?: string;
	/** The principal the debugger is bound to. */
	scope: FlowScope;
	/** Every scope the operator may switch to. A single entry hides the switcher. */
	scopes?: readonly FlowScope[];
	/** Fired when the operator picks a different scope. */
	onScopeChange?: (scope: FlowScope) => void;
	/** The wallets in play. The first is selected when nothing else is. */
	wallets: readonly FlowWallet[];
	/** Controlled selection. Omit to let the component hold it locally. */
	selectedWalletId?: string | null;
	/** Fired when the inspected wallet changes. */
	onSelectWallet?: (walletId: string) => void;
	/** The ordered legs the last simulation produced. */
	legs?: readonly FlowLeg[];
	/** Which stages to offer. Defaults to all four, in pipeline order. */
	stages?: readonly FlowStage[];
	/** Which stages start checked. Defaults to {@link stages}. */
	defaultStages?: readonly FlowStage[];
	/**
	 * The platform fee as the service states it (e.g. `"5%"`). A **string**: this component must
	 * never derive, restate or round a fee. Omitted, the disburse hint says nothing about rate.
	 */
	platformFeeLabel?: string;
	/** A request is in flight — controls lock and a status is announced. */
	busy?: boolean;
	/** A service-level failure, announced through `role="alert"`. */
	error?: string | null;
	/** Run a simulation. */
	onSimulate?: (request: FlowSimulateRequest) => void;
	/** Force a wallet bucket to a value. */
	onSetBalance?: (request: FlowSetBalanceRequest) => void;
	/** Clear the trace (and, by convention, any pending preview). */
	onResetTrace?: () => void;
	/** Initial window position. */
	defaultPosition?: PopoverPosition;
	/** Persist the moved position. */
	onPositionChange?: (position: PopoverPosition) => void;
	/** Initial window size. */
	defaultSize?: PopoverSize;
	/** Persist the resized size. */
	onSizeChange?: (size: PopoverSize) => void;
	/** Panel width until the operator resizes. Defaults to `26rem`. */
	width?: string;
	/** Extra class(es) merged onto the window panel. */
	class?: string;
}
// #endregion

// #region Vocabulary
/** Pipeline order. A simulation always runs stages in this order, whatever order they were ticked. */
const STAGE_ORDER: readonly FlowStage[] = ["purchase", "lock_escrow", "release", "disburse"];

/** Operator-facing stage names. */
const STAGE_LABEL: Record<FlowStage, string> = {
	purchase: "Purchase",
	lock_escrow: "Lock escrow",
	release: "Fast-track release",
	disburse: "Disburse fee + splits",
};

/** One line of why a stage exists, shown under its label. */
const STAGE_HINT: Record<FlowStage, string> = {
	purchase: "Charge the buyer wallet",
	lock_escrow: "Hold the charge against the stage",
	release: "Skip the clearing window",
	disburse: "Pay the platform fee, then the split shares",
};

/** The three writable buckets, in rail order. `projected` is a forecast and is not writable. */
const WRITABLE_BUCKETS: readonly Exclude<FlowBalanceBucket, "projected">[] = [
	"available",
	"escrow",
	"pending",
];

/** Legend labels for the four balance states. */
const BUCKET_LABEL: Record<FlowBalanceBucket, string> = {
	available: "Available",
	escrow: "Escrow-held",
	pending: "Pending",
	projected: "Projected payout",
};

/** Role tags. */
const ROLE_LABEL: Record<FlowWalletRole, string> = {
	acting: "Acting",
	counterparty: "Seller",
	platform: "Platform",
	escrow: "Escrow",
};

/** Scope tags. */
const SCOPE_LABEL: Record<FlowScopeKind, string> = {
	user: "User",
	team: "Team",
	business: "Business",
};

/**
 * The leading sign a leg carries. Purely presentational: the service sends unsigned amounts with a
 * direction, exactly as the wallet surface does.
 */
const LEG_SIGN: Record<FlowLegKind, string> = {
	debit: "−",
	credit: "+",
	hold: "−",
	release: "+",
	fee: "−",
	split: "+",
};

/** Registry glyph per leg kind. Decorative — the label carries the meaning. */
const LEG_ICON: Record<FlowLegKind, IconName> = {
	debit: "arrow-up",
	credit: "arrow-down",
	hold: "lock",
	release: "unlock",
	fee: "tag",
	split: "members",
};
// #endregion

// #region Pure helpers
/**
 * Capital denominator for the rail, in minor units. Prefers the server's `capital`; falls back to
 * the three real states summed. **Geometry only** — the result is never printed.
 */
function capitalMinor(b: FlowBalances): number {
	if (b.capital) return b.capital.minor;
	return b.available.minor + b.escrow.minor + b.pending.minor;
}

/** A share of the denominator, clamped to 0–100. Returns a number, not a figure. */
function shareOf(part: number, total: number): number {
	if (!Number.isFinite(part) || !Number.isFinite(total) || total <= 0) return 0;
	return Math.min(100, Math.max(0, (part / total) * 100));
}

/** A share as a CSS percentage token value, e.g. `"37.4%"`. */
function pctToken(share: number): string {
	return `${share.toFixed(2)}%`;
}

/** A share as a printed proportion — a proportion, never a money figure. */
function pctText(share: number): string {
	if (share > 0 && share < 0.1) return "<0.1%";
	return `${share.toFixed(share >= 10 ? 0 : 1)}%`;
}

/**
 * Parse an operator-entered amount. Minor units only, non-negative integer, no separators — the
 * unit is stated on the label, so there is nothing to convert and no ambiguity to resolve.
 * Returns `null` for anything that is not a clean value.
 */
function parseMinor(raw: string): number | null {
	const trimmed = raw.trim();
	if (!trimmed) return null;
	if (!/^\d{1,15}$/.test(trimmed)) return null;
	const n = Number(trimmed);
	return Number.isSafeInteger(n) ? n : null;
}

/** A spoken money label: the server's string plus its currency code. */
function spoken(label: string, money: FlowMoney): string {
	return `${label}: ${money.display} ${money.currency}`;
}

/** Direction of a before → after change. A sign, never a computed difference. */
function direction(before: FlowMoney, after: FlowMoney): "up" | "down" | "flat" {
	if (after.minor > before.minor) return "up";
	if (after.minor < before.minor) return "down";
	return "flat";
}
// #endregion

// #region Meter
/** Props for the internal four-state meter. */
interface MeterProps {
	balances: FlowBalances;
	labelledBy: string;
}

/**
 * The four-state capital meter.
 *
 * **Segment widths are set from the value and are never animated.** A frozen animation clock — a
 * backgrounded tab, a reduced-motion reader, a paused rAF in a preview pane — must still show
 * correct widths, so no property that ENCODES data carries a transition here; motion is confined to
 * `opacity`/`transform` in the stylesheet. Segments also have no minimum width: a sliver is drawn
 * as a sliver, because a floor would draw a share that does not exist.
 *
 * The rail is `aria-hidden` and decorative. Every fact it carries is in the legend in four
 * redundant channels — shape mark, label, server-rendered figure, printed proportion — so the meter
 * survives colour-blindness, a stylesheet failure and a screen reader alike.
 */
function FlowMeter({ balances, labelledBy }: MeterProps): VNode {
	const total = capitalMinor(balances);
	const shares: Record<FlowBalanceBucket, number> = {
		available: shareOf(balances.available.minor, total),
		escrow: shareOf(balances.escrow.minor, total),
		pending: shareOf(balances.pending.minor, total),
		projected: shareOf(balances.projected.minor, total),
	};
	const rail: FlowBalanceBucket[] = ["available", "escrow", "pending"];

	return (
		<div class="ui-money-flow__meter">
			<div
				class="ui-money-flow__track"
				data-empty={total <= 0 ? "true" : undefined}
				aria-hidden="true"
			>
				{rail.map((bucket) => (
					<span
						key={bucket}
						class="ui-money-flow__seg"
						data-bucket={bucket}
						data-sliver={shares[bucket] > 0 && shares[bucket] < 1 ? "true" : undefined}
						style={styleVars({ "--mf-seg": pctToken(shares[bucket]) })}
					/>
				))}
				<span
					class="ui-money-flow__tick"
					style={styleVars({ "--mf-tick": pctToken(shares.projected) })}
				/>
			</div>
			<dl class="ui-money-flow__legend" aria-labelledby={labelledBy}>
				{(["available", "escrow", "pending", "projected"] as FlowBalanceBucket[]).map((bucket) => (
					<div class="ui-money-flow__row" data-bucket={bucket} key={bucket}>
						<dt class="ui-money-flow__label">
							<span class="ui-money-flow__mark" aria-hidden="true" />
							{BUCKET_LABEL[bucket]}
						</dt>
						<dd class="ui-money-flow__value">
							<span class="ui-money-flow__fig">{balances[bucket].display}</span>
							<span class="ui-money-flow__pct" aria-hidden="true">{pctText(shares[bucket])}</span>
							<span class="ui-visually-hidden">{balances[bucket].currency}</span>
						</dd>
					</div>
				))}
			</dl>
		</div>
	);
}
// #endregion

// #region Before / after
/** Props for the internal before/after preview. */
interface CompareProps {
	before: FlowBalances;
	after: FlowBalances;
}

/**
 * Before/after preview for the inspected wallet. Both columns are server-rendered strings and the
 * middle column is a *direction*, not a delta — printing a computed difference would be this
 * component doing money arithmetic through the back door.
 */
function FlowCompare({ before, after }: CompareProps): VNode {
	const rows: FlowBalanceBucket[] = ["available", "escrow", "pending", "projected"];
	return (
		<table class="ui-money-flow__compare">
			<thead>
				<tr>
					<th scope="col">State</th>
					<th scope="col">Before</th>
					<th scope="col">
						<span class="ui-visually-hidden">Direction</span>
					</th>
					<th scope="col">After</th>
				</tr>
			</thead>
			<tbody>
				{rows.map((bucket) => {
					const dir = direction(before[bucket], after[bucket]);
					return (
						<tr key={bucket} data-bucket={bucket}>
							<th scope="row" class="ui-money-flow__comparelabel">{BUCKET_LABEL[bucket]}</th>
							<td class="ui-money-flow__before">{before[bucket].display}</td>
							<td class="ui-money-flow__delta" data-dir={dir}>
								<Icon
									name={dir === "up" ? "arrow-up" : dir === "down" ? "arrow-down" : "minus"}
									size="2xs"
									title={dir === "up" ? "increases" : dir === "down" ? "decreases" : "unchanged"}
								/>
							</td>
							<td class="ui-money-flow__after">{after[bucket].display}</td>
						</tr>
					);
				})}
			</tbody>
		</table>
	);
}
// #endregion

/**
 * MoneyFlowPopover — a compact, glassmorphic **developer** debugger for money movement, composed on
 * top of {@link DraggablePopover} so it inherits drag, resize, keyboard move/resize, the
 * `BodyPortal` mount, the bounded z-stack and `role="dialog"` + `aria-modal="false"` unchanged. The
 * page beneath stays fully interactive, which is the point: you drive the app while watching the
 * money.
 *
 * **Portability.** `@projective/ui` is copy-paste-portable and may not reach for app code, Zod
 * schemas or an API route, yet a money-flow debugger is inherently app-specific. The resolution is
 * that this component is **fully controlled and data-driven**: it takes wallets, legs and scope as
 * props, describes its structural shapes locally ({@link FlowWallet}, {@link FlowLeg},
 * {@link FlowScope}, {@link FlowSimulateRequest}), performs **no fetch and no money arithmetic**,
 * and emits intent through callbacks. The consuming app wires those to `/api/…` and the fat service
 * does every calculation. Money arrives as a pre-formatted `display` string; the minor units it
 * arrives beside are used for rail geometry and for stating a direction, never to produce a figure.
 *
 * **The meter never lies under a frozen clock.** Segment widths come straight from the values and
 * carry no transition — this codebase has already shipped a meter that animated `flex-grow` with a
 * `backwards` fill and drew every share at zero width in a backgrounded tab. Motion here decorates
 * `opacity`/`transform` only, and reduced-motion jumps to the final state.
 *
 * **Glass.** The blur rides a `::before` underlay, never the panel, so the window does not become
 * the containing block for its own `position: fixed` descendants (the glass-blur fixed-overlay
 * trap).
 */
export function MoneyFlowPopover(props: MoneyFlowPopoverProps): JSX.Element {
	const {
		open,
		onOpenChange,
		title = "Money Flow",
		scope,
		scopes,
		onScopeChange,
		wallets,
		selectedWalletId,
		onSelectWallet,
		legs,
		stages = STAGE_ORDER,
		defaultStages,
		platformFeeLabel,
		busy = false,
		error,
		onSimulate,
		onSetBalance,
		onResetTrace,
		width = "26rem",
		class: className,
	} = props;

	const baseId = useId(undefined, "mflow");
	const trace = legs ?? [];

	// #region Local form state (signal-first)
	const localWalletId = useSignal<string | null>(null);
	const simSource = useSignal<string>("");
	const simTarget = useSignal<string>("");
	const simAmount = useSignal<string>("");
	const simTouched = useSignal<boolean>(false);
	const pickedStages = useSignal<readonly FlowStage[]>(defaultStages ?? stages);
	const overrideWalletId = useSignal<string>("");
	const overrideBucket = useSignal<Exclude<FlowBalanceBucket, "projected">>("available");
	const overrideAmount = useSignal<string>("");
	const overrideTouched = useSignal<boolean>(false);
	// #endregion

	const selectedId = selectedWalletId ?? localWalletId.value ?? wallets[0]?.id ?? null;
	const selected = wallets.find((w) => w.id === selectedId) ?? null;
	/**
	 * The unit amounts are entered in. It comes from a wallet and nowhere else — an opaque scope id
	 * standing in for a currency code would be printed as one and, worse, sent as one on
	 * {@link FlowSimulateRequest}. With no wallets there is no currency, and the label says nothing
	 * rather than something untrue.
	 */
	const currency = selected?.currency ?? wallets[0]?.currency ?? "";

	const pickWallet = (id: string) => {
		localWalletId.value = id;
		onSelectWallet?.(id);
	};

	const sourceId = simSource.value || wallets[0]?.id || "";
	const targetId = simTarget.value || selectedId || "";

	const simMinor = parseMinor(simAmount.value);
	const simInvalid = simTouched.value && simMinor === null;
	const overrideMinor = parseMinor(overrideAmount.value);
	const overrideInvalid = overrideTouched.value && overrideMinor === null;
	const overrideTarget = overrideWalletId.value || selectedId || "";

	const orderedStages = STAGE_ORDER.filter((s) => pickedStages.value.includes(s));
	const canSimulate = !busy && !!onSimulate && !!sourceId && simMinor !== null &&
		orderedStages.length > 0;
	const canOverride = !busy && !!onSetBalance && !!overrideTarget && overrideMinor !== null;

	const toggleStage = (stage: FlowStage, on: boolean) => {
		const next = new Set(pickedStages.value);
		if (on) next.add(stage);
		else next.delete(stage);
		pickedStages.value = STAGE_ORDER.filter((s) => next.has(s));
	};

	const runSimulate = () => {
		simTouched.value = true;
		if (simMinor === null || !sourceId || orderedStages.length === 0) return;
		onSimulate?.({
			scope,
			sourceWalletId: sourceId,
			targetWalletId: targetId || null,
			amountMinor: simMinor,
			currency,
			stages: orderedStages,
		});
	};

	const runOverride = () => {
		overrideTouched.value = true;
		if (overrideMinor === null || !overrideTarget) return;
		onSetBalance?.({
			walletId: overrideTarget,
			bucket: overrideBucket.value,
			amountMinor: overrideMinor,
			currency: wallets.find((w) => w.id === overrideTarget)?.currency ?? currency,
		});
	};

	const simErrId = `${baseId}-sim-err`;
	const ovErrId = `${baseId}-ov-err`;

	return (
		<DraggablePopover
			open={open}
			onOpenChange={onOpenChange}
			title={title}
			icon={<Icon name="wallet" />}
			width={width}
			defaultPosition={props.defaultPosition}
			onPositionChange={props.onPositionChange}
			defaultSize={props.defaultSize}
			onSizeChange={props.onSizeChange}
			class={cx("ui-money-flow-popover", className)}
			headerActions={busy
				? (
					<span class="ui-money-flow-popover__busy" role="status">
						<span class="ui-money-flow-popover__pulse" aria-hidden="true" />
						<span class="ui-visually-hidden">Working…</span>
					</span>
				)
				: undefined}
		>
			<div class="ui-money-flow" aria-busy={busy ? "true" : undefined}>
				{/* #region Scope */}
				<section class="ui-money-flow__scope" aria-label="Active scope">
					<span class="ui-money-flow__scopebadge" data-scope={scope.kind}>
						{SCOPE_LABEL[scope.kind]}
					</span>
					<span class="ui-money-flow__scopename">{scope.label}</span>
					{scope.handle && <span class="ui-money-flow__scopehandle">{scope.handle}</span>}
					{scopes && scopes.length > 1 && (
						<label class="ui-money-flow__scopeswitch">
							<span class="ui-visually-hidden">Switch scope</span>
							<select
								class="ui-money-flow__select"
								value={scope.id}
								disabled={busy}
								onChange={(e) => {
									const next = scopes.find((s) =>
										s.id === (e.currentTarget as HTMLSelectElement).value
									);
									if (next) onScopeChange?.(next);
								}}
							>
								{scopes.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
							</select>
						</label>
					)}
				</section>
				{/* #endregion */}

				{/* #region Wallets + meters */}
				<section class="ui-money-flow__wallets" role="radiogroup" aria-label="Target wallets">
					{wallets.length === 0 && (
						<p class="ui-money-flow__empty">No wallets are bound to this scope.</p>
					)}
					{wallets.map((wallet) => {
						const isSel = wallet.id === selectedId;
						const nameId = `${baseId}-w-${wallet.id}`;
						return (
							<article
								class="ui-money-flow__wallet"
								data-selected={isSel ? "true" : undefined}
								key={wallet.id}
							>
								<label class="ui-money-flow__wallethead">
									<input
										type="radio"
										class="ui-visually-hidden"
										name={`${baseId}-wallet`}
										value={wallet.id}
										checked={isSel}
										disabled={busy}
										onChange={() => pickWallet(wallet.id)}
									/>
									<span class="ui-money-flow__pick" aria-hidden="true" />
									<span class="ui-money-flow__walletname" id={nameId}>{wallet.label}</span>
									{wallet.role && (
										<span class="ui-money-flow__walletrole" data-role={wallet.role}>
											{ROLE_LABEL[wallet.role]}
										</span>
									)}
								</label>
								{wallet.note && <p class="ui-money-flow__walletnote">{wallet.note}</p>}
								<FlowMeter balances={wallet.balances} labelledBy={nameId} />
								{isSel && (
									<div class="ui-money-flow__preview">
										<h3 class="ui-money-flow__subhead">Before / after</h3>
										{wallet.preview
											? <FlowCompare before={wallet.balances} after={wallet.preview} />
											: (
												<p class="ui-money-flow__empty">
													No pending simulation for this wallet.
												</p>
											)}
									</div>
								)}
							</article>
						);
					})}
				</section>
				{/* #endregion */}

				{/* #region Simulate */}
				<details class="ui-money-flow__section" open>
					<summary class="ui-money-flow__sectionhead">
						<Icon name="switch" size="xs" />
						Simulate a flow
					</summary>
					<div class="ui-money-flow__sectionbody">
						<div class="ui-money-flow__grid">
							<label class="ui-money-flow__field">
								<span class="ui-money-flow__flabel">From</span>
								<select
									class="ui-money-flow__select"
									value={sourceId}
									disabled={busy}
									onChange={(e) => {
										simSource.value = (e.currentTarget as HTMLSelectElement).value;
									}}
								>
									{wallets.map((w) => <option key={w.id} value={w.id}>{w.label}</option>)}
								</select>
							</label>
							<label class="ui-money-flow__field">
								<span class="ui-money-flow__flabel">To</span>
								<select
									class="ui-money-flow__select"
									value={targetId}
									disabled={busy}
									onChange={(e) => {
										simTarget.value = (e.currentTarget as HTMLSelectElement).value;
									}}
								>
									<option value="">— none —</option>
									{wallets.map((w) => <option key={w.id} value={w.id}>{w.label}</option>)}
								</select>
							</label>
						</div>
						<label class="ui-money-flow__field">
							<span class="ui-money-flow__flabel">
								Amount{" "}
								<span class="ui-money-flow__unit">
									minor units{currency ? ` (${currency})` : ""}
								</span>
							</span>
							<input
								type="text"
								class="ui-money-flow__input ui-money-flow__num"
								inputMode="numeric"
								autocomplete="off"
								placeholder="12500"
								value={simAmount.value}
								disabled={busy}
								aria-invalid={simInvalid ? "true" : undefined}
								aria-describedby={simInvalid ? simErrId : undefined}
								onInput={(e) => {
									simAmount.value = (e.currentTarget as HTMLInputElement).value;
								}}
								onBlur={() => {
									simTouched.value = true;
								}}
							/>
						</label>
						{simInvalid && (
							<p class="ui-money-flow__err" id={simErrId} role="alert">
								Enter a whole, non-negative amount in minor units — digits only.
							</p>
						)}
						<fieldset class="ui-money-flow__stages">
							<legend class="ui-money-flow__flabel">Stages</legend>
							{stages.map((stage) => (
								<label class="ui-money-flow__stage" key={stage}>
									<input
										type="checkbox"
										checked={pickedStages.value.includes(stage)}
										disabled={busy}
										onChange={(e) =>
											toggleStage(stage, (e.currentTarget as HTMLInputElement).checked)}
									/>
									<span class="ui-money-flow__stagetext">
										<span class="ui-money-flow__stagename">{STAGE_LABEL[stage]}</span>
										<span class="ui-money-flow__stagehint">
											{STAGE_HINT[stage]}
											{stage === "disburse" && platformFeeLabel
												? ` · platform fee ${platformFeeLabel}`
												: ""}
										</span>
									</span>
								</label>
							))}
						</fieldset>
						<div class="ui-money-flow__actions">
							<Button
								label="Run simulation"
								size="sm"
								icon={<Icon name="play" />}
								loading={busy}
								disabled={!canSimulate}
								onClick={runSimulate}
							/>
						</div>
					</div>
				</details>
				{/* #endregion */}

				{/* #region Override */}
				<details class="ui-money-flow__section">
					<summary class="ui-money-flow__sectionhead">
						<Icon name="edit" size="xs" />
						Override a balance
					</summary>
					<div class="ui-money-flow__sectionbody">
						<div class="ui-money-flow__grid">
							<label class="ui-money-flow__field">
								<span class="ui-money-flow__flabel">Wallet</span>
								<select
									class="ui-money-flow__select"
									value={overrideTarget}
									disabled={busy}
									onChange={(e) => {
										overrideWalletId.value = (e.currentTarget as HTMLSelectElement).value;
									}}
								>
									{wallets.map((w) => <option key={w.id} value={w.id}>{w.label}</option>)}
								</select>
							</label>
							<label class="ui-money-flow__field">
								<span class="ui-money-flow__flabel">Bucket</span>
								<select
									class="ui-money-flow__select"
									value={overrideBucket.value}
									disabled={busy}
									onChange={(e) => {
										overrideBucket.value = (e.currentTarget as HTMLSelectElement)
											.value as Exclude<FlowBalanceBucket, "projected">;
									}}
								>
									{WRITABLE_BUCKETS.map((b) => <option key={b} value={b}>{BUCKET_LABEL[b]}
									</option>)}
								</select>
							</label>
						</div>
						<label class="ui-money-flow__field">
							<span class="ui-money-flow__flabel">
								New value <span class="ui-money-flow__unit">minor units</span>
							</span>
							<input
								type="text"
								class="ui-money-flow__input ui-money-flow__num"
								inputMode="numeric"
								autocomplete="off"
								placeholder="0"
								value={overrideAmount.value}
								disabled={busy}
								aria-invalid={overrideInvalid ? "true" : undefined}
								aria-describedby={overrideInvalid ? ovErrId : undefined}
								onInput={(e) => {
									overrideAmount.value = (e.currentTarget as HTMLInputElement).value;
								}}
								onBlur={() => {
									overrideTouched.value = true;
								}}
							/>
						</label>
						{overrideInvalid && (
							<p class="ui-money-flow__err" id={ovErrId} role="alert">
								Enter a whole, non-negative amount in minor units — digits only.
							</p>
						)}
						<p class="ui-money-flow__hint">
							Projected payout is a forecast the service derives; it cannot be written here.
						</p>
						<div class="ui-money-flow__actions">
							<Button
								label="Apply override"
								size="sm"
								variant="outlined"
								severity="warning"
								loading={busy}
								disabled={!canOverride}
								onClick={runOverride}
							/>
						</div>
					</div>
				</details>
				{/* #endregion */}

				{/* #region Trace */}
				<section class="ui-money-flow__tracebox" aria-label="Flow trace">
					<div class="ui-money-flow__tracehead">
						<h3 class="ui-money-flow__subhead">Flow trace</h3>
						<span class="ui-money-flow__count" role="status">
							{trace.length === 1 ? "1 leg" : `${trace.length} legs`}
						</span>
						{onResetTrace && (
							<button
								type="button"
								class="ui-money-flow__iconbtn ui-hit"
								aria-label="Clear flow trace"
								disabled={busy || trace.length === 0}
								onClick={onResetTrace}
							>
								<Icon name="refresh" size="xs" />
							</button>
						)}
					</div>
					{trace.length === 0
						? <p class="ui-money-flow__empty">Run a simulation to see where the money went.</p>
						: (
							<ol class="ui-money-flow__trace">
								{trace.map((leg) => (
									<li
										class="ui-money-flow__leg"
										data-kind={leg.kind}
										data-failed={leg.failed ? "true" : undefined}
										key={leg.id}
									>
										<span class="ui-money-flow__seq" aria-hidden="true">{leg.seq}</span>
										<span class="ui-money-flow__legicon" aria-hidden="true">
											<Icon name={LEG_ICON[leg.kind]} size="2xs" />
										</span>
										<span class="ui-money-flow__legmain">
											<span class="ui-money-flow__leglabel">{leg.label}</span>
											<span class="ui-money-flow__legmeta">
												{leg.walletLabel}
												{leg.at ? ` · ${leg.at}` : ""}
												{leg.failed ? " · refused" : ""}
											</span>
											{leg.note && <span class="ui-money-flow__legnote">{leg.note}</span>}
										</span>
										<span class="ui-money-flow__legmoney">
											<span class="ui-money-flow__amt">
												<span aria-hidden="true">{LEG_SIGN[leg.kind]}</span>
												{leg.amount.display}
											</span>
											<span class="ui-money-flow__after">
												<span class="ui-visually-hidden">
													{spoken("balance after", leg.balanceAfter)}
												</span>
												<span class="ui-money-flow__afterlabel" aria-hidden="true">after</span>
												<span aria-hidden="true">{leg.balanceAfter.display}</span>
											</span>
										</span>
									</li>
								))}
							</ol>
						)}
				</section>
				{/* #endregion */}

				{error && <p class="ui-money-flow__err ui-money-flow__err--block" role="alert">{error}</p>}
			</div>
		</DraggablePopover>
	);
}
