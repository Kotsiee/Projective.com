import type { JSX } from "preact";
import { useSignal } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import { Tooltip } from "@projective/ui/feedback";
import { Icon } from "@projective/ui/icons";
import { Avatar } from "@projective/ui/display";
import { MoneyView } from "@projective/ui/display/money";
import type { WalletPotView, WalletRef, WalletSwitcher } from "../types/wallet-types.ts";
import { walletHref, walletParam } from "../core/wallet-model.ts";
import { accountKind, showsAggregate } from "./WalletHero.tsx";
import { WalletGlyph } from "./wallet-glyphs.tsx";

/** Props for {@link AccountRail}. */
export interface AccountRailProps {
	switcher: WalletSwitcher;
	display: string;
	/** The personal wallet's tax set-aside pot, when the viewer has one and is viewing it. */
	pot: WalletPotView | null;
	reducedMotion: () => boolean;
}

function AccountTile(
	{ account, display, current }: { account: WalletRef; display: string; current: boolean },
) {
	const param = walletParam(account.scope, account.id);
	const aggregate = account.scope === "aggregate";
	return (
		<a
			class="wlt-account"
			href={walletHref(param, display)}
			aria-current={current ? "page" : undefined}
		>
			<span class="wlt-account__head" aria-hidden="true">
				{aggregate
					? (
						<span class="wlt-account__all">
							<Icon name="wallet" size="sm" />
						</span>
					)
					: <Avatar image={account.avatar ?? undefined} label={account.name} size={32} />}
				{current && <span class="wlt-account__current" />}
			</span>
			<span class="wlt-account__name">
				{account.scope === "personal" ? "Personal" : account.name}
			</span>
			<span class="wlt-account__meta">{aggregate ? "Read-only total" : accountKind(account)}</span>
			<span class="wlt-account__foot">
				<MoneyView value={account.available} size="body" hideOrigin class="wlt-account__amount" />
				<span class="wlt-account__unit">available</span>
			</span>
		</a>
	);
}

function PotTile({ pot }: { pot: WalletPotView }): JSX.Element {
	const share = pot.autoAllocateBp / 100;
	return (
		<div class="wlt-account wlt-account--pot">
			<span class="wlt-account__head" aria-hidden="true">
				<span class="wlt-account__all">
					<WalletGlyph name="escrow" size="sm" />
				</span>
			</span>
			<span class="wlt-account__name">{pot.name}</span>
			<span class="wlt-account__meta">
				{share > 0 ? `Sets aside ${share.toLocaleString("en-GB")}% of income` : "Set aside"}
			</span>
			<span class="wlt-account__foot">
				<MoneyView value={pot.balance} size="body" hideOrigin class="wlt-account__amount" />
			</span>
		</div>
	);
}

/**
 * The horizontal rail of every wallet the viewer can see. A tile is a real link that re-scopes the
 * page with `?w=` — a view filter, never a change of acting context.
 */
export function AccountRail(
	{ switcher, display, pot, reducedMotion }: AccountRailProps,
): JSX.Element {
	const railRef = useRef<HTMLUListElement>(null);
	const canBack = useSignal(false);
	const canForward = useSignal(false);
	const activeParam = walletParam(switcher.active.scope, switcher.active.id);

	useEffect(() => {
		const rail = railRef.current;
		if (!rail) return;
		const measure = () => {
			const offset = Math.abs(rail.scrollLeft);
			canBack.value = offset > 1;
			canForward.value = offset + rail.clientWidth < rail.scrollWidth - 1;
		};
		measure();
		const observer = new ResizeObserver(measure);
		observer.observe(rail);
		rail.addEventListener("scroll", measure, { passive: true });
		return () => {
			observer.disconnect();
			rail.removeEventListener("scroll", measure);
		};
	}, []);

	const step = (dir: 1 | -1) => {
		const rail = railRef.current;
		if (!rail) return;
		const rtl = getComputedStyle(rail).direction === "rtl";
		rail.scrollBy({
			left: dir * (rtl ? -1 : 1) * rail.clientWidth * 0.8,
			behavior: reducedMotion() ? "auto" : "smooth",
		});
	};

	const personalFirst = switcher.accounts.filter((a) => a.scope === "personal");
	const vaults = switcher.accounts.filter((a) => a.scope !== "personal");

	return (
		<section class="wlt-section wlt-accounts" aria-labelledby="wlt-accounts-title">
			<header class="wlt-section__head">
				<h2 id="wlt-accounts-title" class="wlt-section__title">Accounts</h2>
				{(canBack.value || canForward.value) && (
					<div class="wlt-accounts__nav">
						<Tooltip content="Previous accounts">
							<button
								type="button"
								class="wlt-iconbtn"
								aria-label="Previous accounts"
								disabled={!canBack.value}
								onClick={() => step(-1)}
							>
								<Icon name="chevron-left" size="sm" class="wlt-mirror" />
							</button>
						</Tooltip>
						<Tooltip content="More accounts">
							<button
								type="button"
								class="wlt-iconbtn"
								aria-label="More accounts"
								disabled={!canForward.value}
								onClick={() => step(1)}
							>
								<Icon name="chevron-right" size="sm" class="wlt-mirror" />
							</button>
						</Tooltip>
					</div>
				)}
			</header>
			<ul class="wlt-accounts__rail" ref={railRef}>
				{personalFirst.map((a) => (
					<li key="personal" class="wlt-accounts__item">
						<AccountTile account={a} display={display} current={activeParam === "personal"} />
					</li>
				))}
				{pot && (
					<li key="pot" class="wlt-accounts__item">
						<PotTile pot={pot} />
					</li>
				)}
				{vaults.map((a) => {
					const param = walletParam(a.scope, a.id);
					return (
						<li key={param} class="wlt-accounts__item">
							<AccountTile account={a} display={display} current={activeParam === param} />
						</li>
					);
				})}
				{showsAggregate(switcher) && (
					<li key="aggregate" class="wlt-accounts__item">
						<AccountTile
							account={switcher.aggregate}
							display={display}
							current={activeParam === "aggregate"}
						/>
					</li>
				)}
			</ul>
		</section>
	);
}
