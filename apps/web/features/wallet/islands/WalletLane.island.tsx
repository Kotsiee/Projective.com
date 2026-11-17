import type { JSX } from "preact";
import { useSignal } from "@preact/signals";
import { useEffect } from "preact/hooks";
import "../styles/wallet.css";
import { Tooltip } from "@projective/ui/feedback";
import { Icon } from "@projective/ui/icons";
import { LaneCollapseButton, LaneFooter, LaneList } from "@projective/ui/navigation";
import { SidebarToggleIcon } from "@web/features/shell/core/nav-icons.tsx";
import { MIDDLE_LANE_TOGGLE_EVENT } from "@web/utils/lane-events.ts";
import type { WalletOverview } from "../types/wallet-types.ts";
import {
	type FlowPeriod,
	viewLabel,
	WALLET_VIEWS,
	walletPageHref,
	type WalletView,
} from "../core/wallet-model.ts";
import {
	walletFlowLive,
	walletOverviewLive,
	type WalletSchedules,
	walletSchedulesLive,
} from "../core/wallet-state.ts";
import { VerificationGate } from "../components/VerificationGate.tsx";
import { VIEW_ICON, WalletPageNav } from "../components/WalletPageNav.tsx";
import { WalletRails } from "../components/WalletRails.tsx";

/** Props for {@link WalletLane}. */
export interface WalletLaneProps {
	/** The wallet as the server read it for the lane, or `null` when it could not be read. */
	overview: WalletOverview | null;
	/** The wallet's recurring deposits and automatic payout as the server read them for the lane. */
	schedules: WalletSchedules | null;
	/** The page on screen. */
	view: WalletView | null;
	/** The `?w=` param of the wallet on screen. */
	wallet: string;
	display: string;
	flow: FlowPeriod | null;
	/** The currency wallet the page is narrowed to (`?currency=`, Decision #435). */
	currency?: string | null;
}

// #region Collapsed rail
function WalletRail(props: WalletLaneProps & { onExpand: () => void }): JSX.Element {
	return (
		<div class="wlt-rail" aria-label="Wallet (collapsed)">
			<nav class="wlt-rail__group" aria-label="Wallet pages">
				{WALLET_VIEWS.map((view) => (
					<Tooltip key={view} content={viewLabel(view)} placement="right">
						<a
							class="wlt-rail__item"
							href={walletPageHref(view, props.wallet, props.display, props.flow, props.currency)}
							aria-label={viewLabel(view)}
							aria-current={view === props.view ? "page" : undefined}
						>
							<Icon name={VIEW_ICON[view]} size="md" />
						</a>
					</Tooltip>
				))}
			</nav>
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
 * The `/wallet` middle-nav lane, identical on every wallet page: the wallet's four pages as the lanes'
 * shared `NavItem` rows; beneath them, past one hairline, the wallet at a glance — its pots and its
 * standing schedules ({@link WalletRails}); the verification gate pinned above the footer band; and
 * the footer band holding only the collapse toggle. It carries no money action: Top up, Transfer,
 * Withdraw and the rest live in the hero, on every page, so each has one home. No tiles, no boxes
 * (§B.6, §B.9.7). It renders both presentations and lets `.ui-splitter[data-mode="collapsed"]` reveal
 * one — the expanded stack or an icon rail of the pages — like every other lane.
 *
 * It paints the overview and the schedules the server read for it, then follows what the page body
 * publishes after a money movement, so its rails and gate agree with the page.
 */
export default function WalletLane(props: WalletLaneProps): JSX.Element {
	const collapsed = useSignal(false);

	useEffect(() => {
		const el = globalThis.document?.querySelector(".ui-splitter");
		collapsed.value = (el as HTMLElement | null)?.dataset.mode === "collapsed";
	}, []);

	const setCollapsed = (next: boolean) => {
		collapsed.value = next;
		globalThis.dispatchEvent(
			new CustomEvent(MIDDLE_LANE_TOGGLE_EVENT, { detail: { collapsed: next } }),
		);
	};

	const overview = walletOverviewLive.value ?? props.overview;
	const schedules = walletSchedulesLive.value ?? props.schedules;
	const flow = walletFlowLive.value ?? props.flow;

	return (
		<div class="wlt-lane">
			<WalletRail {...props} flow={flow} onExpand={() => setCollapsed(false)} />

			<div class="wlt-lane__full">
				<LaneList label="Wallet" class="wlt-lane__list">
					<div class="wlt-lane__body">
						<WalletPageNav
							variant="lane"
							view={props.view}
							wallet={props.wallet}
							display={props.display}
							flow={flow}
							currency={props.currency}
						/>
						{overview && (
							<WalletRails overview={overview} schedules={schedules} idPrefix="wlt-lane" />
						)}
					</div>
				</LaneList>

				{overview && (
					<div class="wlt-lane__foot">
						<VerificationGate overview={overview} />
					</div>
				)}

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
