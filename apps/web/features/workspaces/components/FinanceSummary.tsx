import type { JSX } from "preact";
import { kindCopy, type WorkspaceFinance, type WorkspaceKind } from "@projective/types/workspace";
import { PolicyAmount } from "./PolicyAmount.tsx";
import { StatTile } from "./StatTile.tsx";
import { cloneGlyph, WalletGlyph } from "../core/workspace-glyphs.tsx";

/**
 * FinanceSummary — the entity's money at a glance, and a door to the real thing.
 *
 * **This is deliberately not a finance UI.** `/wallet` already ships context-scoped vaults, the
 * three-state balance projection, the team split projection, payouts, methods, invoices, spend
 * approvals, the verification lock and the RtL pass. Building a second one here would mean two
 * implementations of the same arithmetic drifting apart, and the one on this page would be the one
 * nobody maintained. So this renders three server-computed figures and hands off
 * (`walletHrefFor(kind, id)` → `/wallet?w=kind:id`).
 *
 * Note the wallet link is a page-local VIEW scope, not a context switch (brief §6.1): following it
 * shows you this entity's figures, it does not make you act as the entity. The copy says "Open" and
 * "view", never "switch to", because those two controls must never be confused.
 *
 * Every figure arrives as a pre-formatted `MoneyView` — the client never totals, converts or
 * fee-adjusts money.
 */

export interface FinanceSummaryProps {
	kind: WorkspaceKind;
	finance: WorkspaceFinance;
	/** Whether the viewer may see the deep link at all — a member without finance rights does not. */
	canOpen?: boolean;
}

/** The overview's money band: three tiles plus the wallet hand-off. */
export function FinanceSummary(props: FinanceSummaryProps): JSX.Element {
	const { finance, kind } = props;
	const copy = kindCopy(kind);
	// A team EARNS, so its second and third states are money on the way in; a business SPENDS, so the
	// same two slots mean money already committed. Same projection, honestly different labels.
	const lockedLabel = kind === "team" ? "In escrow" : "Committed";
	const pendingLabel = kind === "team" ? "Clearing" : "Awaiting approval";

	return (
		<div class="wsp-money-mod">
			<div class="wsp-tiles">
				<StatTile
					label="Available"
					value={finance.available.display}
					delta={finance.delta}
					trend={finance.trend}
					caption={`Ready to ${kind === "team" ? "withdraw or distribute" : "spend"}`}
					icon={cloneGlyph(WalletGlyph)}
				/>
				<StatTile
					label={lockedLabel}
					value={finance.locked.display}
					caption={kind === "team"
						? "Held against stages still in flight"
						: "Allocated to work in progress"}
				/>
				<StatTile
					label={pendingLabel}
					value={finance.pending.display}
					caption={kind === "team"
						? "Released, inside the clearing window"
						: "Requests waiting on a decision"}
				/>
			</div>

			{props.canOpen !== false && (
				<p class="wsp-moneyhead">
					<span class="wsp-moneyhead__figure">
						<PolicyAmount
							value={finance.available}
							size="body"
							srLabel={`Available in the ${copy.moneyNoun}`}
						/>
					</span>
					<a class="wsp-moneyhead__link" href={finance.walletHref}>
						Open the full {copy.moneyNoun}
					</a>
				</p>
			)}
		</div>
	);
}
