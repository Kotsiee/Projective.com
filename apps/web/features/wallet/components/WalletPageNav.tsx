import type { JSX } from "preact";
import { Icon, type IconName } from "@projective/ui/icons";
import { NavItem } from "@projective/ui/navigation";
import {
	type FlowPeriod,
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
	/** The currency wallet the pages are narrowed to (`?currency=`, Decision #435), kept on every link. */
	currency?: string | null;
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

/**
 * The wallet's four page links — real addresses, each carrying the wallet and the currency — as the
 * lanes' shared `NavItem` rows on a wide screen and as a horizontal strip on a phone, where the shell
 * removes the lane. Invoices is listed for every wallet: a wallet that is not billed reads its page as
 * the sentence saying so, so the lane reads the same whichever wallet the carousel lands on.
 */
export function WalletPageNav(props: WalletPageNavProps): JSX.Element {
	return (
		<nav
			class={props.variant === "lane" ? "wlt-pages" : "wlt-pagestrip"}
			aria-label="Wallet pages"
		>
			<ul class={props.variant === "lane" ? "wlt-pages__list" : "wlt-pagestrip__list"}>
				{WALLET_VIEWS.map((view) => {
					const current = view === props.view;
					const href = walletPageHref(
						view,
						props.wallet,
						props.display,
						props.flow,
						props.currency,
					);
					return (
						<li key={view}>
							{props.variant === "lane"
								? (
									<NavItem
										href={href}
										label={viewLabel(view)}
										icon={<Icon name={VIEW_ICON[view]} size="md" />}
										active={current}
									/>
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
