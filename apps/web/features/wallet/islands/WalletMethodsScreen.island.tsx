import type { JSX } from "preact";
import { useSignal } from "@preact/signals";
import "../styles/wallet.css";
import { SectionCard } from "../components/wallet-bits.tsx";
import { WalletIcon } from "../components/wallet-glyphs.tsx";
import { WalletService } from "../core/WalletService.ts";
import { currentWalletContext, openWalletAction } from "../core/wallet-state.ts";
import { useWalletRefresh, useWalletSeam } from "../core/wallet-seam.ts";
import type { MethodsView, PaymentMethodView } from "../types/wallet-types.ts";

/**
 * WalletMethodsScreen — `/wallet/methods`: payment methods tagged funding (spend) / payout (earn) / both,
 * with default-spend & default-payout markers. Card entry is Stripe-hosted (the add modal), never a
 * card-number field. THIN: SSR + refetch on dev axis / mutation.
 */
export interface WalletMethodsScreenProps {
	initial: MethodsView;
	wallet: string;
	display: string;
}

const ROLE_LABEL: Record<string, string> = {
	funding: "Spend",
	payout: "Earn",
	both: "Spend & earn",
};

export default function WalletMethodsScreen(props: WalletMethodsScreenProps): JSX.Element {
	const view = useSignal<MethodsView>(props.initial);
	async function reload(): Promise<void> {
		const res = await WalletService.methods(currentWalletContext());
		if (res.ok && res.data) view.value = res.data.methods;
	}
	useWalletSeam({ display: props.display, wallet: props.wallet, onRefetch: reload });
	useWalletRefresh(reload);

	const m = view.value;
	return (
		<div class="wallet-page wallet-methods-page">
			<header class="wallet-page__head">
				<h1 class="wallet-page__title">Payment methods</h1>
				<button
					type="button"
					class="wallet-btn wallet-btn--primary"
					onClick={() => openWalletAction("add_method")}
				>
					<WalletIcon name="card" size={16} /> Add method
				</button>
			</header>

			<SectionCard>
				{m.methods.length === 0
					? (
						<p class="wallet-empty-note">
							No payment methods. Add a card or bank to fund and get paid.
						</p>
					)
					: (
						<ul class="wallet-methodcards">
							{m.methods.map((pm) => <MethodCard key={pm.id} method={pm} />)}
						</ul>
					)}
			</SectionCard>

			<p class="wallet-page__foot-note">
				<WalletIcon name="access" size={14} />{" "}
				Card details are held securely by Stripe — Projective never sees or stores them.
			</p>
		</div>
	);
}

function MethodCard({ method }: { method: PaymentMethodView }): JSX.Element {
	return (
		<li class="wallet-methodcard" data-status={method.status}>
			<span class="wallet-methodcard__brand">
				<WalletIcon name="card" size={22} />
			</span>
			<span class="wallet-methodcard__meta">
				<span class="wallet-methodcard__name">
					{method.brand ?? "Card"} ·· {method.last4 ?? "0000"}
				</span>
				<span class="wallet-methodcard__sub">{method.label ?? ROLE_LABEL[method.methodRole]}</span>
			</span>
			<span class="wallet-methodcard__tags">
				<span class="wallet-badge" data-tone="neutral">{ROLE_LABEL[method.methodRole]}</span>
				{method.isDefaultFunding && (
					<span class="wallet-badge" data-tone="info">
						Default spend
					</span>
				)}
				{method.isDefaultPayout && (
					<span class="wallet-badge" data-tone="info">
						Default payout
					</span>
				)}
			</span>
		</li>
	);
}
