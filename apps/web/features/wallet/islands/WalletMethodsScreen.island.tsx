import type { JSX } from "preact";
import { useSignal } from "@preact/signals";
import "../styles/wallet.css";
import { Grid } from "@projective/ui/layout";
import { Band, EmptyBand, PageHead, WalletErrorBand } from "../components/band-parts.tsx";
import { PaymentCard } from "../components/PaymentCard.tsx";
import { WalletService } from "../core/WalletService.ts";
import { activeMethodId, currentWalletContext, walletError } from "../core/wallet-state.ts";
import { applyRead, useWalletRefresh, useWalletSeam } from "../core/wallet-seam.ts";
import type { MethodsView } from "../types/wallet-types.ts";

/**
 * WalletMethodsScreen — the tokenized instruments (`/wallet/methods`).
 *
 * A full-bleed grid of card faces, bounded by a column CAP rather than by a container width. The
 * face shows `•••• •••• •••• 4455` + brand + label + role badges and nothing else: card data is
 * Stripe-hosted and never touches our servers, so there is no expiry element, no cardholder-name
 * element, no CVV affordance and no flip-to-reveal-back anywhere in this tree. The absence is the
 * point — an affordance implying we hold data we do not is worse than an empty zone (§12.6).
 */
export interface WalletMethodsScreenProps {
	initial: MethodsView;
	wallet: string;
	display: string;
}

export default function WalletMethodsScreen(props: WalletMethodsScreenProps): JSX.Element {
	const view = useSignal<MethodsView>(props.initial);

	const refetch = async () => {
		const res = await WalletService.methods(currentWalletContext());
		applyRead(res, (d) => {
			view.value = d.methods;
		});
	};
	useWalletSeam({ display: props.display, wallet: props.wallet, onRefetch: refetch });
	useWalletRefresh(refetch);

	const m = view.value.methods;

	return (
		<main class="wlt" aria-label="Payment methods">
			<div class="wlt__stack">
				<WalletErrorBand message={walletError.value} />
				<Band tone="head" index={0} label="Methods">
					<PageHead title="Payment methods" meta={<span>{m.length} saved</span>} />
				</Band>

				<Band tone="page" index={1} label="Saved methods">
					{m.length === 0
						? (
							<EmptyBand
								text="No payment methods saved."
								hint="Choose “Add method” in the action bar. Card details are collected and held by Stripe."
							/>
						)
						: (
							<>
								<Grid minChildWidth="19rem" maxCols={4} gap="var(--space-5)">
									{m.map((method, i) => (
										<PaymentCard
											key={method.id}
											method={method}
											size="grid"
											index={i}
											interactive
											onOpen={(id) => {
												activeMethodId.value = id;
											}}
										/>
									))}
								</Grid>
								<p class="wlt-prose wlt-methods__note">
									Card details are collected and held by Stripe. Projective stores only the brand,
									the last four digits, your label, and whether the method is active.
								</p>
							</>
						)}
				</Band>
			</div>
		</main>
	);
}
