import type { JSX } from "preact";
import { Tooltip } from "@projective/ui/feedback";
import { Avatar } from "@projective/ui/display";
import { SidebarToggleIcon } from "@web/features/shell/core/nav-icons.tsx";
import { WalletIcon } from "./wallet-glyphs.tsx";
import { walletHref, type WalletNavEntry, type WalletView } from "../core/wallet-model.ts";
import type { WalletSwitcher } from "../types/wallet-types.ts";

/**
 * WalletRail — the Wallet lane's collapsed presentation, revealed by `.ui-splitter[data-mode="collapsed"]`
 * (the same density switch as `CatalogueRail`/`ProjectRail`). A compact icon column: the active wallet's
 * avatar, the capability-gated sub-nav as `--shell-nav-block` squares (portal-tooltip'd, active-tinted),
 * and a bottom Expand toggle reusing the global rail's morphing glyph. Dumb — the island owns state.
 */
export interface WalletRailProps {
	switcher: WalletSwitcher;
	nav: WalletNavEntry[];
	activeView: WalletView;
	activeWallet: string;
	onExpand: () => void;
}

export function WalletRail(
	{ switcher, nav, activeView, activeWallet, onExpand }: WalletRailProps,
): JSX.Element {
	const active = switcher.active;
	return (
		<div class="wallet-rail" aria-label="Wallet (collapsed)">
			<div class="wallet-rail__top">
				<Tooltip content={active.name} placement="right">
					<a class="wallet-rail__brand" href="/wallet" aria-label={active.name}>
						{active.scope === "aggregate" || !active.avatar
							? <WalletIcon name="wallet" size={20} />
							: <Avatar image={active.avatar} label={active.name} size={30} alt="" />}
					</a>
				</Tooltip>
			</div>

			<div class="wallet-rail__items" role="list" aria-label="Wallet sections">
				{nav.map((entry) => (
					<Tooltip key={entry.view} content={entry.label} placement="right">
						<a
							class="wallet-rail__item"
							href={walletHref(entry.view, activeWallet)}
							data-active={entry.view === activeView ? "true" : undefined}
							role="listitem"
							aria-label={entry.label}
							aria-current={entry.view === activeView ? "page" : undefined}
						>
							<WalletIcon name={entry.icon} size={20} />
						</a>
					</Tooltip>
				))}
			</div>

			<div class="wallet-rail__bottom">
				<Tooltip content="Expand lane" placement="right">
					<button
						type="button"
						class="wallet-rail__toggle"
						data-collapsed="true"
						aria-label="Expand lane"
						onClick={onExpand}
					>
						<SidebarToggleIcon />
					</button>
				</Tooltip>
			</div>
		</div>
	);
}
