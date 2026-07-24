import type { JSX } from "preact";
import { Tooltip } from "@projective/ui/feedback";
import { Money } from "./wallet-bits.tsx";
import type { MoneyView } from "../types/wallet-types.ts";

/**
 * BalanceHero — the calm face's headline: the large **Available** balance in the viewer's display
 * currency, with **Locked / Pending / On-hold** as secondary chips (never merged into one misleading
 * number — finance-model.md §7's three-state projection is shown as three states). Each secondary chip
 * carries a plain-language tooltip; a zero state dims rather than hides so the shape stays legible.
 * Lifetime earnings sit as a quiet caption. Pure component — logical properties throughout.
 */
export interface BalanceHeroProps {
	available: MoneyView;
	locked: MoneyView;
	pending: MoneyView;
	onHold: MoneyView;
	lifetime: MoneyView;
	/** A short scope caption ("Personal wallet" / "Northwind Studio vault"). */
	caption: string;
}

interface SecondaryProps {
	label: string;
	value: MoneyView;
	tone: string;
	hint: string;
}

function Secondary({ label, value, tone, hint }: SecondaryProps): JSX.Element {
	const zero = value.minor === 0;
	return (
		<Tooltip content={hint} placement="top">
			<div class="wallet-hero__chip" data-tone={tone} data-zero={zero ? "true" : undefined}>
				<span class="wallet-hero__chip-label">{label}</span>
				<Money value={value} class="wallet-hero__chip-value" />
			</div>
		</Tooltip>
	);
}

export function BalanceHero(props: BalanceHeroProps): JSX.Element {
	return (
		<section class="wallet-hero" aria-label="Balance">
			<div class="wallet-hero__main">
				<span class="wallet-hero__eyebrow">{props.caption} · Available</span>
				<Money value={props.available} class="wallet-hero__amount" />
				<span class="wallet-hero__lifetime">
					Lifetime <Money value={props.lifetime} muted />
				</span>
			</div>
			<div class="wallet-hero__states" role="group" aria-label="Balance states">
				<Secondary
					label="In escrow"
					value={props.locked}
					tone="info"
					hint="Capital locked on active stages — released as milestones complete."
				/>
				<Secondary
					label="Clearing"
					value={props.pending}
					tone="warning"
					hint="Released funds inside the 7-day safety window before they become available."
				/>
				<Secondary
					label="On hold"
					value={props.onHold}
					tone="danger"
					hint="Contested funds held in the Dispute Lockbox until the dispute resolves."
				/>
			</div>
		</section>
	);
}
