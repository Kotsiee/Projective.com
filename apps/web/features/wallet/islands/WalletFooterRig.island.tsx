import type { JSX } from "preact";
import { useSignal } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import "../styles/wallet.css";
import { Popover, Tooltip } from "@projective/ui/feedback";
import { ViewZoomRig } from "@web/features/shell/components/ViewZoomRig.tsx";
import {
	ComfortableRowsGlyph,
	CompactRowsGlyph,
	DistributeGlyph,
	ExportGlyph,
	FundEscrowGlyph,
	GateGlyph,
	MoreGlyph,
	PayoutScheduleGlyph,
	RecurringGlyph,
	RequestSpendGlyph,
	SaveMethodGlyph,
	SmootherGlyph,
	TopUpGlyph,
	TransferGlyph,
	WithdrawGlyph,
} from "../core/glyphs.tsx";
import { actionsFor, type ResolvedAction, type WalletView } from "../core/capability.ts";
import { openWalletAction } from "../core/wallet-state.ts";
import { walletZoom } from "../core/view-state.ts";
import MoneyMoveDrawer from "./MoneyMoveDrawer.island.tsx";
import ConfigureDrawer from "./ConfigureDrawer.island.tsx";
import ConfirmMoveModal from "./ConfirmMoveModal.island.tsx";
import type {
	MoneyView,
	PaymentMethodView,
	PersonalExtras,
	TeamExtras,
	VaultCapability,
	WalletAction,
	WalletRef,
	WalletVariant,
	WalletVerification,
} from "../types/wallet-types.ts";

/**
 * WalletFooterRig — the sticky action bar, and the ONLY place on this surface money moves from.
 *
 * Two gates, behaving deliberately differently (§5.3):
 *
 *  - **Capability → absence.** A member who cannot distribute never sees Distribute. Showing it
 *    disabled advertises a power they will not have on this vault.
 *  - **Verification → disablement with a reason.** The viewer holds the capability; a step is
 *    outstanding. The button stays, carries the one permitted lock glyph, and opens a nudge with the
 *    path forward. Removing it hides the path; locking it teaches the path.
 *
 * **Adaptation is by WIDTH, not by page identity, and no action is ever lost to it.** The rig
 * previously keyed its whole configuration off a `TABLE_VIEWS` set, which produced three separate
 * defects: a row-density control on two pages that render no rows; a mobile rule that hid actions 3-n
 * outright on exactly the pages with no menu to recover them; and — because the labelled cluster is
 * `nowrap` — a 739px min-content floor that this band exported to the whole middle-nav frame, starving
 * the nav lane to 2px at an 820px viewport. All three are fixed here by the same two decisions:
 *
 *  1. **The menu always holds every action**, so hiding the inline cluster can never remove a path to
 *     money. The cluster is a shortcut for the leading few, never the only route.
 *  2. **`container-type: inline-size` on the rig root** (wallet-chrome.css) makes its width a function
 *     of the band rather than of its contents, so the rig can no longer bid for space the lane is
 *     standing in — and it gives the tier switch a container query, so the collapse is CSS-driven and
 *     deterministic (the `.ui-splitter[data-mode]` precedent) rather than a client width observer.
 *
 * The middle tier drops the labels and keeps the glyphs, which is §B.6.3's icon-only sticky footer
 * rather than an invention; every action carries a `Tooltip` + `aria-label` at every tier, so the
 * label is relocated, not deleted.
 */
export interface WalletFooterRigProps {
	view: WalletView;
	variant: WalletVariant;
	scope: string;
	quickActions: WalletAction[];
	capabilities: VaultCapability[];
	verification: WalletVerification;
	/** The action layer's data. The rig owns the layer because the rig is what opens it. */
	accounts: WalletRef[];
	activeAccount: WalletRef;
	available: MoneyView;
	methods: PaymentMethodView[];
	team: TeamExtras | null;
	personal: PersonalExtras | null;
}

const ACTION_GLYPH: Record<WalletAction, JSX.Element> = {
	top_up: TopUpGlyph,
	withdraw: WithdrawGlyph,
	transfer: TransferGlyph,
	distribute: DistributeGlyph,
	fund_escrow: FundEscrowGlyph,
	new_recurring: RecurringGlyph,
	add_method: SaveMethodGlyph,
	set_payout: PayoutScheduleGlyph,
	request_spend: RequestSpendGlyph,
	enrol_smoother: SmootherGlyph,
};

/**
 * Views that render a real, density-driven table. `walletZoom` is read by exactly one body island
 * (`LedgerTable`), so this is the only page where a row-density control changes anything — Payouts and
 * Invoices render `<dl>`/`<ul>` fact lists and Access a fixed capability matrix, and all three shipped
 * a slider that moved nothing.
 */
const TABLE_VIEWS: ReadonlySet<WalletView> = new Set(["transactions"]);

/**
 * The action each page exists to perform. It leads the cluster and takes the single primary weight
 * (§B.8.2), so the Methods page opens on Add method rather than on Top up. A page absent from this map
 * is a reading page and keeps the server's own order.
 */
const VIEW_ACTION: Partial<Record<WalletView, WalletAction>> = {
	overview: "top_up",
	funding: "new_recurring",
	methods: "add_method",
	payouts: "set_payout",
};

/** How many actions the inline cluster holds. The remainder are reachable in the menu, which holds all. */
const INLINE_SLOTS = 5;

/** Move the view's own action to the front without disturbing the rest of the server's order. */
function orderForView(actions: ResolvedAction[], view: WalletView): ResolvedAction[] {
	const lead = VIEW_ACTION[view];
	if (!lead) return actions;
	const i = actions.findIndex((a) => a.action === lead);
	if (i <= 0) return actions;
	return [actions[i], ...actions.slice(0, i), ...actions.slice(i + 1)];
}

export default function WalletFooterRig(props: WalletFooterRigProps): JSX.Element {
	const menuOpen = useSignal(false);
	const nudge = useSignal<ResolvedAction | null>(null);
	const nudgeOpen = useSignal(false);
	const menuRef = useRef<HTMLButtonElement>(null);
	const nudgeRef = useRef<HTMLButtonElement>(null);

	useEffect(() => walletZoom.restoreZoom(), []);

	const actions = orderForView(
		actionsFor(props.quickActions, props.capabilities, props.verification, props.variant),
		props.view,
	);
	const hasTable = TABLE_VIEWS.has(props.view);
	const readOnly = props.scope === "aggregate";
	const inline = actions.slice(0, INLINE_SLOTS);
	const overflows = actions.length > INLINE_SLOTS;

	const activate = (a: ResolvedAction, el: HTMLButtonElement | null) => {
		if (a.locked) {
			nudgeRef.current = el;
			nudge.value = a;
			nudgeOpen.value = true;
			return;
		}
		menuOpen.value = false;
		openWalletAction(a.action);
	};

	/**
	 * `primary` is granted to the leading INLINE action only. The menu is its own decision region and
	 * lists everything at one weight — a filled row inside a list of ten reads as a recommendation the
	 * surface has no business making.
	 */
	const button = (a: ResolvedAction, i: number, inMenu: boolean) => {
		const control = (
			<button
				type="button"
				class="wlt-footerrig__action"
				data-variant={i === 0 && !inMenu ? "primary" : "tonal"}
				data-locked={a.locked ? "true" : "false"}
				aria-disabled={a.locked ? "true" : undefined}
				aria-label={a.label}
				role={inMenu ? "menuitem" : undefined}
				onClick={(e) => activate(a, e.currentTarget as HTMLButtonElement)}
			>
				<span class="wlt-footerrig__glyph" aria-hidden="true">
					{a.locked ? GateGlyph : ACTION_GLYPH[a.action]}
				</span>
				<span class="wlt-footerrig__label">{a.label}</span>
			</button>
		);
		// In the menu the label is always visible, so a tooltip would only repeat it.
		return inMenu
			? <span key={a.action}>{control}</span>
			: (
				<Tooltip key={a.action} content={a.locked ? `${a.label} — ${a.prompt ?? ""}` : a.label}>
					{control}
				</Tooltip>
			);
	};

	return (
		<div
			class="wlt-footerrig"
			data-density={hasTable ? "true" : "false"}
			data-overflow={overflows ? "true" : "false"}
		>
			{hasTable && (
				<ViewZoomRig
					store={walletZoom}
					label="Row density"
					class="wlt-footerrig__density"
					listIcon={CompactRowsGlyph}
					gridIcon={ComfortableRowsGlyph}
				/>
			)}

			{readOnly
				? <span class="wlt-footerrig__note">Read-only rollup</span>
				: actions.length > 0 && (
					<>
						<div class="wlt-footerrig__actions">
							{inline.map((a, i) => button(a, i, false))}
						</div>

						<Tooltip content="All wallet actions" placement="top">
							<button
								type="button"
								class="wlt-footerrig__more"
								ref={menuRef}
								aria-label="All wallet actions"
								aria-haspopup="menu"
								aria-expanded={menuOpen.value ? "true" : "false"}
								onClick={() => {
									menuOpen.value = !menuOpen.value;
								}}
							>
								<span class="wlt-footerrig__glyph" aria-hidden="true">{MoreGlyph}</span>
								<span class="wlt-footerrig__more-label">Actions</span>
							</button>
						</Tooltip>
						<Popover open={menuOpen} targetRef={menuRef} placement="top-end">
							<div class="wlt-footerrig__menu" role="menu">
								{actions.map((a, i) => button(a, i, true))}
							</div>
						</Popover>
					</>
				)}

			<Tooltip content="Export as CSV" placement="top">
				<a
					class="wlt-footerrig__export"
					aria-label="Export as CSV"
					href={`/api/wallet/export?w=${encodeURIComponent(props.scope)}`}
				>
					<span class="wlt-footerrig__glyph" aria-hidden="true">{ExportGlyph}</span>
					<span class="wlt-footerrig__label">Export</span>
				</a>
			</Tooltip>

			<Popover open={nudgeOpen} targetRef={nudgeRef} placement="top">
				{nudge.value && (
					<div class="wlt-footerrig__nudge">
						<p class="wlt-footerrig__nudge-text">{nudge.value.prompt}</p>
						{
							/* A navigation, so a link (§B.8.1) — and in a two-line popover whose entire purpose
						    is this one path forward, a link is not quiet, it is the only thing to do. */
						}
						{nudge.value.href && (
							<a class="wlt-link" href={nudge.value.href}>Finish verification</a>
						)}
					</div>
				)}
			</Popover>

			{
				/*
				 * The action layer, mounted once per route beside the control that opens it. Composition
				 * (a drawer that keeps the ledger legible) and commitment (a modal that deliberately
				 * removes the escape route) stay two surfaces; configuration is reversible and commits
				 * from its own drawer without a confirmation step.
				 */
			}
			{!readOnly && (
				<>
					<MoneyMoveDrawer
						accounts={props.accounts}
						available={props.available}
						methods={props.methods}
						team={props.team}
						activeAccount={props.activeAccount}
					/>
					<ConfigureDrawer
						methods={props.methods}
						available={props.available}
						personal={props.personal}
					/>
					<ConfirmMoveModal />
				</>
			)}
		</div>
	);
}
