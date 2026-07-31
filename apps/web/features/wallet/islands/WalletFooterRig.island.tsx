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
	RecurringGlyph,
	RequestSpendGlyph,
	SmootherGlyph,
	TopUpGlyph,
	TransferGlyph,
	WithdrawGlyph,
} from "../core/glyphs.tsx";
import { actionsFor, type ResolvedAction, type WalletView } from "../core/capability.ts";
import { openWalletAction } from "../core/wallet-state.ts";
import { walletZoom } from "../core/view-state.ts";
import type {
	VaultCapability,
	WalletAction,
	WalletVariant,
	WalletVerification,
} from "../types/wallet-types.ts";

/**
 * WalletFooterRig — the 48px sticky action bar, and the ONLY place on this surface money moves from.
 *
 * Two gates, behaving deliberately differently (§5.3):
 *
 *  - **Capability → absence.** A member who cannot distribute never sees Distribute. Showing it
 *    disabled advertises a power they will not have on this vault.
 *  - **Verification → disablement with a reason.** The viewer holds the capability; a step is
 *    outstanding. The button stays, carries the one permitted lock glyph, and opens a nudge with the
 *    path forward. Removing it hides the path; locking it teaches the path.
 *
 * On a table page the cluster collapses into one menu and yields the leading edge to density and
 * sort, because on those pages the frequent act is reading, not moving money.
 */
export interface WalletFooterRigProps {
	view: WalletView;
	variant: WalletVariant;
	scope: string;
	quickActions: WalletAction[];
	capabilities: VaultCapability[];
	verification: WalletVerification;
}

const ACTION_GLYPH: Record<WalletAction, JSX.Element> = {
	top_up: TopUpGlyph,
	withdraw: WithdrawGlyph,
	transfer: TransferGlyph,
	distribute: DistributeGlyph,
	fund_escrow: FundEscrowGlyph,
	new_recurring: RecurringGlyph,
	add_method: RecurringGlyph,
	set_payout: WithdrawGlyph,
	request_spend: RequestSpendGlyph,
	enrol_smoother: SmootherGlyph,
};

/** Pages whose primary act is reading a table, so density and sort take the leading edge. */
const TABLE_VIEWS: ReadonlySet<WalletView> = new Set([
	"transactions",
	"payouts",
	"invoices",
	"access",
]);

export default function WalletFooterRig(props: WalletFooterRigProps): JSX.Element {
	const menuOpen = useSignal(false);
	const nudge = useSignal<ResolvedAction | null>(null);
	const nudgeOpen = useSignal(false);
	const menuRef = useRef<HTMLButtonElement>(null);
	const nudgeRef = useRef<HTMLButtonElement>(null);

	useEffect(() => walletZoom.restoreZoom(), []);

	const actions = actionsFor(
		props.quickActions,
		props.capabilities,
		props.verification,
		props.variant,
	);
	const isTable = TABLE_VIEWS.has(props.view);
	const readOnly = props.scope === "aggregate";

	const activate = (a: ResolvedAction, el: HTMLButtonElement | null) => {
		if (a.locked) {
			nudgeRef.current = el;
			nudge.value = a;
			nudgeOpen.value = true;
			return;
		}
		openWalletAction(a.action);
	};

	const button = (a: ResolvedAction, i: number) => (
		<button
			key={a.action}
			type="button"
			class="wlt-footerrig__action"
			data-variant={i === 0 && !isTable ? "primary" : "tonal"}
			data-locked={a.locked ? "true" : "false"}
			aria-disabled={a.locked ? "true" : undefined}
			onClick={(e) => activate(a, e.currentTarget as HTMLButtonElement)}
		>
			<span class="wlt-footerrig__glyph" aria-hidden="true">
				{a.locked ? GateGlyph : ACTION_GLYPH[a.action]}
			</span>
			{a.label}
		</button>
	);

	return (
		<div class="wlt-footerrig" data-mode={isTable ? "table" : "overview"}>
			{isTable && (
				<ViewZoomRig
					store={walletZoom}
					label="Row density"
					class="wlt-footerrig__density"
					listIcon={CompactRowsGlyph}
					gridIcon={ComfortableRowsGlyph}
				/>
			)}

			{readOnly ? <span class="wlt-footerrig__note">Read-only rollup</span> : isTable
				? (
					<>
						<Tooltip content="Wallet actions" placement="top">
							<button
								type="button"
								class="wlt-footerrig__more"
								ref={menuRef}
								aria-label="Wallet actions"
								aria-haspopup="menu"
								aria-expanded={menuOpen.value}
								onClick={() => {
									menuOpen.value = !menuOpen.value;
								}}
							>
								{MoreGlyph}
								<span class="wlt-footerrig__more-label">Actions</span>
							</button>
						</Tooltip>
						<Popover open={menuOpen} targetRef={menuRef} placement="top-end">
							<div class="wlt-footerrig__menu" role="menu">
								{actions.map((a, i) => button(a, i))}
							</div>
						</Popover>
					</>
				)
				: <div class="wlt-footerrig__actions">{actions.map((a, i) => button(a, i))}</div>}

			<a
				class="wlt-footerrig__export"
				href={`/api/wallet/export?w=${encodeURIComponent(props.scope)}`}
			>
				<span class="wlt-footerrig__glyph" aria-hidden="true">{ExportGlyph}</span>
				Export
			</a>

			<Popover open={nudgeOpen} targetRef={nudgeRef} placement="top">
				{nudge.value && (
					<div class="wlt-footerrig__nudge">
						<p class="wlt-footerrig__nudge-text">{nudge.value.prompt}</p>
						{nudge.value.href && (
							<a class="wlt-btn wlt-btn--primary" href={nudge.value.href}>Finish verification</a>
						)}
					</div>
				)}
			</Popover>
		</div>
	);
}
