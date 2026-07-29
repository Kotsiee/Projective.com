import type { JSX } from "preact";
import { useSignal } from "@preact/signals";
import "../styles/wallet.css";
import { Band, BandHead } from "../components/band-parts.tsx";
import { IntelligenceBand } from "../components/IntelligenceBand.tsx";
import { IncomingTimeline } from "../components/IncomingTimeline.tsx";
import { RecentLedger } from "../components/RecentLedger.tsx";
import { FlowBand } from "../components/FlowBand.tsx";
import { Money } from "../components/Money.tsx";
import CapitalMeter from "./CapitalMeter.island.tsx";
import CardDeck from "./CardDeck.island.tsx";
import MoneyMoveDrawer from "./MoneyMoveDrawer.island.tsx";
import ConfirmMoveModal from "./ConfirmMoveModal.island.tsx";
import { WalletService } from "../core/WalletService.ts";
import { currentWalletContext, fundFilter, resetOnRefetch } from "../core/wallet-state.ts";
import { flowPeriod } from "../core/wallet-state.ts";
import { useWalletRefresh, useWalletSeam } from "../core/wallet-seam.ts";
import type {
	MethodsView,
	WalletOverview,
	WalletRef,
	WalletSwitcher,
} from "../types/wallet-types.ts";

/**
 * WalletOverviewScreen — the Overview body: a vertical stack of FULL-BLEED bands.
 *
 * This is the single hydration root for the overview. The band contents are ordinary components
 * rather than separate island roots on purpose: they all read the same {@link WalletOverview}
 * object, and one root means one refetch owner and one serialisation of that object rather than
 * five copies of it in the page's island props.
 *
 * The band stack is deliberately NOT a card grid (BUILD CONTRACT §4). A wallet holds other people's
 * money against contracted work, so every figure is given the full width of the content region —
 * a number the interface hedges about is a number the user distrusts. `max-inline-size` appears
 * nowhere in this tree.
 *
 * THIN: it paints from SSR and refetches only when the shared read context changes (display
 * currency, dev axis, flow range, or a completed mutation). Money strings always come from the
 * server; the hero's count-up interpolates between them and writes the server string on its final
 * frame, and never re-animates on a refetch.
 */
export interface WalletOverviewScreenProps {
	initial: WalletOverview;
	switcher: WalletSwitcher;
	methods: MethodsView;
	wallet: string;
	display: string;
}

export default function WalletOverviewScreen(props: WalletOverviewScreenProps): JSX.Element {
	const overview = useSignal<WalletOverview>(props.initial);

	const refetch = async () => {
		const res = await WalletService.overview(currentWalletContext());
		if (res.ok && res.data) {
			overview.value = res.data.overview;
			// A fund-state filter selected against one wallet's ledger must not silently persist
			// into another's.
			resetOnRefetch();
		}
	};
	useWalletSeam({ display: props.display, wallet: props.wallet, onRefetch: refetch });
	useWalletRefresh(refetch);

	const o = overview.value;
	const scope = props.wallet;
	const isAggregate = o.ref.scope === "aggregate";
	const accounts: WalletRef[] = props.switcher.accounts;

	return (
		<main class="wlt" aria-label="Wallet overview">
			<div class="wlt__stack">
				{/* Band 1 — the balance identity, and (except on the read-only rollup) the card deck. */}
				<Band tone="hero" index={0} label="Balance">
					<div class="wlt-herorow" data-deck={isAggregate ? "false" : "true"}>
						<CapitalMeter overview={o} scope={scope} />
						{!isAggregate && (
							<div class="wlt-herorow__aside">
								<CardDeck methods={props.methods.methods} canManage={!isAggregate} />
							</div>
						)}
					</div>
				</Band>

				{/* Band 2 — money in vs out, edge to edge. FlowBand owns its own band + head. */}
				<FlowBand
					flow={o.flow}
					range={o.flowRange}
					totalIn={null}
					totalOut={null}
					net={null}
					id="wlt-flow-chart"
					index={1}
				/>

				{/* Band 3 — the variant intelligence band. */}
				<IntelligenceBand overview={o} accounts={accounts} display={props.display} index={2} />

				{/* Band 4 — money on the way, and the most recent movements. */}
				<Band tone="ledger" index={3} titleId="wlt-ledger-title">
					<div class="wlt-ledgerrow">
						<div class="wlt-ledgerrow__incoming">
							<BandHead
								id="wlt-ledger-title"
								title="On the way"
								meta={o.incoming.length > 0
									? <Money value={o.pending} size="body" tone="muted" showFx={false} />
									: undefined}
							/>
							<IncomingTimeline items={o.incoming} />
						</div>
						<div class="wlt-ledgerrow__recent">
							<BandHead id="wlt-recent-title" title="Recent" />
							<RecentLedger
								lines={o.recent}
								total={0}
								scope={scope}
								display={props.display}
								filter={fundFilter.value}
							/>
						</div>
					</div>
				</Band>
			</div>

			{
				/*
				 * The money-movement layer is mounted once, here, and driven by the footer rig's signals.
				 * Composition (a drawer that keeps the ledger legible) and commitment (a modal that
				 * deliberately removes the escape route) are two surfaces, not one.
				 */
			}
			<MoneyMoveDrawer
				accounts={props.switcher.accounts}
				available={o.available}
				methods={props.methods.methods}
				team={o.team}
				activeAccount={o.ref}
			/>
			<ConfirmMoveModal />
		</main>
	);
}
