import type { JSX } from "preact";
import type { BusinessMoneyTile } from "@projective/types/workspace";
import { type MoneyValue, MoneyView, StatTile, StatTileRow } from "@projective/ui/display";
import { possessive } from "../core/refusal-copy.ts";

/**
 * FinanceSummary — a business's money at a glance on its Overview, and a door to the real thing.
 *
 * **This is deliberately not a finance UI.** `/wallet` already ships context-scoped vaults, the
 * balance projection, payouts, methods, invoices, spend approvals, the verification lock and the RtL
 * pass. Building a second one here would mean two implementations of the same arithmetic drifting
 * apart, and the one on this page would be the one nobody maintained. So this renders BB9's
 * server-computed tiles — per wallet currency, Available · Committed · Awaiting approval · Spent in
 * 30 days — and hands off (`walletHrefFor("business", id)` → `/wallet?w=business:id`). Each figure is
 * said once: the hand-off is a link, not a second Available beside it.
 *
 * Note the wallet link is a page-local VIEW scope, not a context switch (brief §6.1): following it
 * shows you this business's figures, it does not make you act as the business. The copy says "Open",
 * never "switch to", because those two controls must never be confused.
 *
 * Every figure arrives as a server-resolved `MoneyView` — the client never totals, converts or
 * fee-adjusts money — and is drawn PINNED to its row's own currency: a row is "money in USD", so its
 * figures are dollars, whatever currency the viewer browses in, and they read exactly as the Finance
 * module's balance line does. A team has no band: its money is the Overview's vault tile.
 *
 * The band renders only for a viewer who may open Finance, and every such viewer may open the
 * business wallet (`businessMoney`), so the hand-off has no gate of its own.
 */

export interface FinanceSummaryProps {
	/** BB9's tiles, one per wallet currency, the business's default currency first. */
	tiles: readonly BusinessMoneyTile[];
	/** The business wallet (`walletHrefFor("business", id)`). */
	walletHref: string;
	/** The business's name, for each tile row's accessible label. */
	name: string;
}

/** One tile's figure in its row's own currency — never converted into the viewer's. */
function TileMoney(props: { value: MoneyValue; currency: string }): JSX.Element {
	return <MoneyView value={props.value} displayCurrency={props.currency} size="body" />;
}

/** The Overview's money band: a row of four tiles per currency, then the wallet hand-off. */
export function FinanceSummary(props: FinanceSummaryProps): JSX.Element {
	const { tiles, name } = props;
	const several = tiles.length > 1;

	return (
		<div class="wsp-money-mod">
			{tiles.map((tile) => (
				<StatTileRow
					key={tile.currency}
					label={several
						? `${possessive(name)} money in ${tile.currency}`
						: `${possessive(name)} money`}
					class="wsp-tiles"
				>
					<StatTile
						label="Available"
						value={<TileMoney value={tile.available} currency={tile.currency} />}
						caption="Ready to spend"
					/>
					<StatTile
						label="Committed"
						value={<TileMoney value={tile.committed} currency={tile.currency} />}
						caption="Held in escrow for work in progress"
					/>
					<StatTile
						label="Awaiting approval"
						value={<TileMoney value={tile.awaitingApproval} currency={tile.currency} />}
						caption="Requests waiting on a decision"
					/>
					<StatTile
						label="Spent (30d)"
						value={<TileMoney value={tile.spent30d} currency={tile.currency} />}
						caption="Paid out in the last 30 days"
					/>
				</StatTileRow>
			))}

			<p class="wsp-moneyhead">
				<a class="wsp-moneyhead__link" href={props.walletHref}>Open the business wallet</a>
			</p>
		</div>
	);
}
