import type { JSX } from "preact";
import { Band, BandHead, EmptyBand } from "./band-parts.tsx";
import { SmootherPanel } from "./SmootherPanel.tsx";
import { PotsPanel } from "./PotsPanel.tsx";
import { SplitPreview } from "./SplitPreview.tsx";
import { MemberStakes } from "./MemberStakes.tsx";
import { BurnDownPanel } from "./BurnDownPanel.tsx";
import { CapsRoster } from "./CapsRoster.tsx";
import { AccountsRollup } from "./AccountsRollup.tsx";
import { StandingGauge } from "./StandingGauge.tsx";
import type { WalletOverview, WalletRef } from "../types/wallet-types.ts";

/**
 * IntelligenceBand — band 3, and the ONE band that swaps by wallet variant.
 *
 * This is the structural idea the whole surface rests on: one route, one identical chrome, and a
 * single band of the body that changes to answer the question this *kind* of wallet is actually
 * asked. A freelancer asks "when does my money arrive and what does my reputation pay me"; a team
 * asks "how does this divide"; a business asks "how much of the budget is left and who spent it".
 * A single generic dashboard would answer none of them well.
 *
 *   personal  → income smoothing + pots (left)  ·  the Standing gauge (right)
 *   team      → the split-rule preview (left)   ·  member stakes (right)
 *   business  → the budget burn-down (left)     ·  spending caps + invoices due (right)
 *   aggregate → a full-bleed per-account rollup, read-only
 */
export interface IntelligenceBandProps {
	overview: WalletOverview;
	/** The switcher's accounts, used only by the read-only aggregate rollup. */
	accounts?: WalletRef[];
	display: string;
	index?: number;
}

export function IntelligenceBand(props: IntelligenceBandProps): JSX.Element | null {
	const o = props.overview;

	// The read-only rollup: the variant extras belong to a single wallet, so the aggregate shows
	// where the money actually sits instead.
	if (o.ref.scope === "aggregate") {
		return (
			<Band tone="accounts" index={props.index} titleId="wlt-intel-title">
				<BandHead id="wlt-intel-title" title="Accounts" />
				<AccountsRollup
					accounts={props.accounts ?? []}
					total={o.available}
					display={props.display}
				/>
			</Band>
		);
	}

	if (o.variant === "personal" && o.personal) {
		const p = o.personal;
		// A client wallet carries no smoother and no pots — it gets its spend context instead, and
		// the Standing gauge is omitted entirely rather than drawn empty (a buyer earns no rung).
		return (
			<Band tone="intel" index={props.index} titleId="wlt-intel-title">
				<BandHead id="wlt-intel-title" title="Your money at work" />
				<div class="wlt-intel wlt-intel--personal" data-standing={o.standing ? "true" : "false"}>
					<div class="wlt-intel__plate">
						{p.incomeSmoother && <SmootherPanel smoother={p.incomeSmoother} />}
						<PotsPanel
							taxPot={p.taxPot}
							projectedFromLocked={p.projectedFromLocked}
							fundingSource={p.fundingSource}
							spentThisMonth={p.spentThisMonth}
						/>
					</div>
					{o.standing && (
						<div class="wlt-intel__plate wlt-intel__plate--standing">
							<StandingGauge standing={o.standing} />
						</div>
					)}
				</div>
			</Band>
		);
	}

	if (o.variant === "team" && o.team) {
		return (
			<Band tone="intel" index={props.index} titleId="wlt-intel-title">
				<BandHead id="wlt-intel-title" title="How this vault divides" />
				<div class="wlt-intel wlt-intel--team">
					<div class="wlt-intel__plate">
						<SplitPreview team={o.team} />
					</div>
					<div class="wlt-intel__plate">
						<MemberStakes members={o.team.members} vaultBalance={o.team.vaultBalance} />
					</div>
				</div>
			</Band>
		);
	}

	if (o.variant === "business" && o.business) {
		return (
			<Band tone="intel" index={props.index} titleId="wlt-intel-title">
				<BandHead id="wlt-intel-title" title="Budget and spend" />
				<div class="wlt-intel wlt-intel--business">
					<div class="wlt-intel__plate">
						<BurnDownPanel burn={o.business.burnDown} />
					</div>
					<div class="wlt-intel__plate">
						<CapsRoster
							caps={o.business.caps}
							invoicesDue={o.business.invoicesDue}
							invoicesDueAmount={o.business.invoicesDueAmount}
						/>
					</div>
				</div>
			</Band>
		);
	}

	// A wallet with no variant extras yet (a brand-new vault). The band keeps its place in the
	// stack rather than vanishing, so the surface's rhythm is stable while it fills in.
	return (
		<Band tone="intel" index={props.index} titleId="wlt-intel-title">
			<BandHead id="wlt-intel-title" title="Your money at work" />
			<EmptyBand text="Nothing to summarise yet." hint="This fills in as money moves." />
		</Band>
	);
}
