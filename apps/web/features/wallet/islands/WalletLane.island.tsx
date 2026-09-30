import type { JSX } from "preact";
import { useSignal } from "@preact/signals";
import { useEffect } from "preact/hooks";
import "../styles/wallet.css";
import { Tooltip } from "@projective/ui/feedback";
import { Icon } from "@projective/ui/icons";
import { LaneCollapseButton, LaneFooter, LaneHead, LaneList } from "@projective/ui/navigation";
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

/** Opens an action's dialog; a locked one opens the dialog that explains why. */
function run(action: WalletAction): void {
	openWalletDialog({ kind: "action", action });
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
 * The `/wallet` middle-nav lane: the wallet's pages as real links, the verification gate when one is
 * open, and every money action the viewer is offered as an icon-led grid. It renders both
 * presentations and lets `.ui-splitter[data-mode="collapsed"]` reveal one — the expanded stack or an
 * icon rail — like every other lane.
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
				<LaneHead>
					<p class="wlt-lane__title">Wallet</p>
				</LaneHead>

				<LaneList label="Wallet">
					<div class="wlt-lane__body">
						<WalletPageNav
							variant="lane"
							view={props.view}
							wallet={props.wallet}
							display={props.display}
							flow={flow}
							business={overview?.business ?? null}
						/>

						{overview && (
							<VerificationGate overview={overview} class="wlt-lane__gate" />
						)}

						{overview && (
							<section class="wlt-lane__group" aria-labelledby="wlt-lane-actions">
								<h2 id="wlt-lane-actions" class="wlt-lane__heading">Actions</h2>
								{actions.length > 0
									? (
										<ul class="wlt-lane__actions">
											{actions.map((item) => (
												<li key={item.action}>
													<button
														type="button"
														class="wlt-qa"
														data-locked={item.locked ? "true" : undefined}
														aria-label={item.locked ? `${item.label}, unavailable` : undefined}
														onClick={() => run(item.action)}
													>
														<span class="wlt-qa__icon" aria-hidden="true">
															<ActionIcon action={item.action} size="md" />
															{item.locked && <Icon name="lock" class="wlt-qa__lock" />}
														</span>
														<span class="wlt-qa__label">{item.label}</span>
													</button>
												</li>
											))}
										</ul>
									)
									: (
										<p class="wlt-lane__note">
											{aggregate
												? "A read-only total. Choose an account to move money."
												: "You can view this vault. Money actions belong to its owners and admins."}
										</p>
									)}
							</section>
						)}
					</div>
				</LaneList>

				<LaneFooter>
					<LaneCollapseButton
						collapsed={collapsed.value}
						icon={<SidebarToggleIcon />}
						onToggle={() => setCollapsed(!collapsed.value)}
					/>
				</LaneFooter>
			</div>
		</div>
	);
}
