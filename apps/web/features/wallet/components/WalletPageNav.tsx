import type { JSX } from "preact";
import { Icon, type IconName } from "@projective/ui/icons";
import {
	type FlowPeriod,
	hasInvoices,
	viewLabel,
	WALLET_VIEWS,
	walletPageHref,
	type WalletView,
} from "../core/wallet-model.ts";

/** Props for {@link WalletPageNav}. */
export interface WalletPageNavProps {
	/** The page on screen, or `null` when the pathname names none. */
	view: WalletView | null;
	/** The `?w=` param of the wallet every link keeps. */
	wallet: string;
	display: string;
	/** The cash-flow window, carried to the pages that draw one. */
	flow?: FlowPeriod | null;
	/** The business extras of the wallet, when it is a business vault — the only wallet that is billed. */
	business: unknown;
	/** `lane` lists icon-led rows; `strip` is the phone's horizontal switcher at the top of the sheet. */
	variant: "lane" | "strip";
}

/** Each page's glyph, shared by the lane rows, the collapsed rail and the phone strip. */
export const VIEW_ICON: Readonly<Record<WalletView, IconName>> = {
	overview: "wallet",
	transactions: "list",
	analytics: "analytics",
	invoices: "document",
};

/** The pages this wallet offers: invoices only where the wallet is billed. */
export function walletViewsFor(business: unknown): WalletView[] {
	return WALLET_VIEWS.filter((view) => view !== "invoices" || hasInvoices(business));
}

/**
 * The wallet's page links — real addresses, each carrying the wallet and the currency — as lane rows
 * on a wide screen and as a horizontal strip on a phone, where the shell removes the lane.
 */
export function WalletPageNav(props: WalletPageNavProps): JSX.Element {
	const views = walletViewsFor(props.business);
	return (
		<nav
			class={props.variant === "lane" ? "wlt-pages" : "wlt-pagestrip"}
			aria-label="Wallet pages"
		>
			<ul class={props.variant === "lane" ? "wlt-pages__list" : "wlt-pagestrip__list"}>
				{views.map((view) => {
					const current = view === props.view;
					const href = walletPageHref(view, props.wallet, props.display, props.flow);
					return (
						<li key={view}>
							{props.variant === "lane"
								? (
									<a
										class="wlt-link-row"
										href={href}
										aria-current={current ? "page" : undefined}
									>
										<span class="wlt-link-row__icon" aria-hidden="true">
											<Icon name={VIEW_ICON[view]} size="sm" />
										</span>
										<span class="wlt-link-row__label">{viewLabel(view)}</span>
									</a>
								)
								: (
									<a
										class="wlt-pagestrip__link"
										href={href}
										aria-current={current ? "page" : undefined}
									>
										{viewLabel(view).replace(" & statements", "")}
									</a>
								)}
						</li>
					);
				})}
			</ul>
		</nav>
	);
}
