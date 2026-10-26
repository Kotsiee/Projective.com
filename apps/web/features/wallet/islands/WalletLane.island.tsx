import type { JSX } from "preact";
import { useSignal } from "@preact/signals";
import { useEffect } from "preact/hooks";
import "../styles/wallet.css";
import { Tooltip } from "@projective/ui/feedback";
import { Icon } from "@projective/ui/icons";
import { Button } from "@projective/ui/fields";
import {
	LaneCollapseButton,
	LaneCreateButton,
	LaneFooter,
	LaneFooterActions,
	LaneHead,
	LaneIconButton,
	LaneList,
} from "@projective/ui/navigation";
import { SidebarToggleIcon } from "@web/features/shell/core/nav-icons.tsx";
import { MIDDLE_LANE_TOGGLE_EVENT } from "@web/utils/lane-events.ts";
import type { WalletAction, WalletOverview } from "../types/wallet-types.ts";
import { resolveAction, type ResolvedAction } from "../core/wallet-home.ts";
import {
	type FlowPeriod,
	viewLabel,
	walletPageHref,
	type WalletView,
} from "../core/wallet-model.ts";
import { openWalletDialog, walletFlowLive, walletOverviewLive } from "../core/wallet-state.ts";
import { ActionIcon } from "../components/wallet-glyphs.tsx";
import { VerificationGate } from "../components/VerificationGate.tsx";
import { VIEW_ICON, WalletPageNav, walletViewsFor } from "../components/WalletPageNav.tsx";

/** Props for {@link WalletLane}. */
export interface WalletLaneProps {
	/** The wallet as the server read it for the lane, or `null` when it could not be read. */
	overview: WalletOverview | null;
	/** The page on screen. */
	view: WalletView | null;
	/** The `?w=` param of the wallet on screen. */
	wallet: string;
	display: string;
	flow: FlowPeriod | null;
}

/**
 * The lane's action order: the six money actions a wallet is managed with, then anything else the
 * server offers this viewer (Split, Fund escrow, Request spend, Smooth my income) so the lane is the one
 * place every offered action can be found.
 */
const LANE_ORDER: readonly WalletAction[] = [
	"top_up",
	"transfer",
	"withdraw",
	"new_recurring",
	"add_method",
	"set_payout",
];

function laneActions(overview: WalletOverview): ResolvedAction[] {
	if (overview.ref.scope === "aggregate") return [];
	const offered = overview.quickActions;
	const first = LANE_ORDER.filter((a) => offered.includes(a));
	const rest = offered.filter((a) => !LANE_ORDER.includes(a));
	return [...first, ...rest].map((a) =>
		resolveAction(a, overview.unavailable, overview.verification)
	);
}

/** The two actions the footer band carries as words; the head keeps the rest as icons. */
const FOOTER_ACTIONS: readonly WalletAction[] = ["top_up", "withdraw"];

/** Opens an action's dialog; a locked one opens the dialog that explains why. */
function run(action: WalletAction): void {
	openWalletDialog({ kind: "action", action });
}

/** A footer action's glyph: its own, or the lock while it is unavailable (pressing still explains). */
function FooterIcon({ item }: { item: ResolvedAction }): JSX.Element {
	return item.locked
		? <Icon name="lock" size="sm" />
		: <ActionIcon action={item.action} size="sm" />;
}

/** A worded footer action needs no tooltip to name it; a locked one gets one carrying the reason. */
function LockReason(
	{ item, children }: { item: ResolvedAction; children: JSX.Element },
): JSX.Element {
	if (!item.locked) return children;
	return (
		<Tooltip content={`${item.label} — ${item.reason ?? "unavailable right now"}`}>
			{children}
		</Tooltip>
	);
}

// #region Collapsed rail
function WalletRail(
	props: WalletLaneProps & { overview: WalletOverview | null; onExpand: () => void },
): JSX.Element {
	const views = walletViewsFor(props.overview?.business ?? null);
	const actions = props.overview ? laneActions(props.overview) : [];
	return (
		<div class="wlt-rail" aria-label="Wallet (collapsed)">
			<nav class="wlt-rail__group" aria-label="Wallet pages">
				{views.map((view) => (
					<Tooltip key={view} content={viewLabel(view)} placement="right">
						<a
							class="wlt-rail__item"
							href={walletPageHref(view, props.wallet, props.display, props.flow)}
							aria-label={viewLabel(view)}
							aria-current={view === props.view ? "page" : undefined}
						>
							<Icon name={VIEW_ICON[view]} size="md" />
						</a>
					</Tooltip>
				))}
			</nav>
			{actions.length > 0 && (
				<div class="wlt-rail__group wlt-rail__group--actions" role="group" aria-label="Actions">
					{actions.map((item) => (
						<Tooltip
							key={item.action}
							content={item.locked ? `${item.label} — unavailable` : item.label}
							placement="right"
						>
							<button
								type="button"
								class="wlt-rail__item"
								data-locked={item.locked ? "true" : undefined}
								aria-label={item.locked ? `${item.label}, unavailable` : item.label}
								onClick={() => run(item.action)}
							>
								<ActionIcon action={item.action} size="md" />
								{item.locked && <Icon name="lock" class="wlt-rail__lock" />}
							</button>
						</Tooltip>
					))}
				</div>
			)}
			<div class="wlt-rail__bottom">
				<LaneCollapseButton
					collapsed
					icon={<SidebarToggleIcon />}
					tooltipPlacement="right"
					onToggle={props.onExpand}
				/>
			</div>
		</div>
	);
}
// #endregion

/**
 * The `/wallet` middle-nav lane, identical on every wallet page, in four bands: the head carries the
 * money actions other than Top up and Withdraw as the lanes' icon-only `LaneIconButton`s; the body
 * centres the wallet's pages as the lanes' shared `NavItem` rows; the foot pins the standing facts —
 * the verification gate (one pip-led line) and why there is nothing to press; and the footer band
 * carries Withdraw (tier-4 outlined) beside Top up (the lane's one `LaneCreateButton`), the `/projects`
 * Create project pattern. No tiles, no boxes (§B.6, §B.9.7). It renders both presentations and lets
 * `.ui-splitter[data-mode="collapsed"]` reveal one — the expanded stack or an icon rail — like every
 * other lane.
 *
 * An action opens its dialog in place: the page body on every wallet route hosts the dialogs, so the
 * lane only names which one. It follows the overview the page publishes after a money movement rather
 * than the snapshot it was server-rendered with.
 */
export default function WalletLane(props: WalletLaneProps): JSX.Element {
	const collapsed = useSignal(false);

	useEffect(() => {
		try {
			const el = globalThis.document?.querySelector(".ui-splitter");
			collapsed.value = (el as HTMLElement | null)?.dataset.mode === "collapsed";
		} catch { /* no DOM — non-fatal */ }
	}, []);

	const setCollapsed = (next: boolean) => {
		collapsed.value = next;
		try {
			globalThis.dispatchEvent(
				new CustomEvent(MIDDLE_LANE_TOGGLE_EVENT, { detail: { collapsed: next } }),
			);
		} catch { /* SSR / no window — non-fatal */ }
	};

	const overview = walletOverviewLive.value ?? props.overview;
	const flow = walletFlowLive.value ?? props.flow;
	const actions = overview ? laneActions(overview) : [];
	const headActions = actions.filter((item) => !FOOTER_ACTIONS.includes(item.action));
	const topUp = actions.find((item) => item.action === "top_up");
	const withdraw = actions.find((item) => item.action === "withdraw");
	const aggregate = overview?.ref.scope === "aggregate";

	return (
		<div class="wlt-lane">
			<WalletRail
				{...props}
				overview={overview}
				flow={flow}
				onExpand={() => setCollapsed(false)}
			/>

			<div class="wlt-lane__full">
				{headActions.length > 0 && (
					<LaneHead class="wlt-lane__head">
						<div class="wlt-lane__actions" role="group" aria-label="Wallet actions">
							{headActions.map((item) => (
								<LaneIconButton
									key={item.action}
									icon={
										<span class="wlt-lane__actionicon" aria-hidden="true">
											<ActionIcon action={item.action} size="sm" />
											{item.locked && <Icon name="lock" class="wlt-lane__lock" />}
										</span>
									}
									label={item.locked ? `${item.label}, unavailable` : item.label}
									tooltip={item.locked
										? `${item.label} — ${item.reason ?? "unavailable right now"}`
										: item.label}
									onClick={() => run(item.action)}
								/>
							))}
						</div>
					</LaneHead>
				)}

				<LaneList label="Wallet" class="wlt-lane__list">
					<div class="wlt-lane__body">
						<WalletPageNav
							variant="lane"
							view={props.view}
							wallet={props.wallet}
							display={props.display}
							flow={flow}
							business={overview?.business ?? null}
						/>
					</div>
				</LaneList>

				{
					/* Standing facts about this wallet, pinned above the footer band: the verification gate,
					   and why there is nothing to press. */
				}
				<div class="wlt-lane__foot">
					{overview && <VerificationGate overview={overview} />}
					{overview && actions.length === 0 && (
						<p class="wlt-lane__note">
							{aggregate
								? "A read-only total. Choose an account to move money."
								: "You can view this vault. Money actions belong to its owners and admins."}
						</p>
					)}
				</div>

				<LaneFooter>
					<LaneCollapseButton
						collapsed={collapsed.value}
						icon={<SidebarToggleIcon />}
						onToggle={() => setCollapsed(!collapsed.value)}
					/>

					{(topUp || withdraw) && (
						<LaneFooterActions>
							{withdraw && (
								<LockReason item={withdraw}>
									<Button
										variant="outlined"
										severity="neutral"
										size="sm"
										rounded
										icon={<FooterIcon item={withdraw} />}
										label={withdraw.label}
										aria-label={withdraw.locked ? `${withdraw.label}, unavailable` : withdraw.label}
										onClick={() => run("withdraw")}
									/>
								</LockReason>
							)}
							{topUp && (
								<LockReason item={topUp}>
									<LaneCreateButton
										label={topUp.label}
										icon={<FooterIcon item={topUp} />}
										onClick={() => run("top_up")}
									/>
								</LockReason>
							)}
						</LaneFooterActions>
					)}
				</LaneFooter>
			</div>
		</div>
	);
}
