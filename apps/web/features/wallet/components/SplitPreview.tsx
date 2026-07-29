import type { JSX } from "preact";
import { styleVars } from "@ui/core/style.ts";
import { Money } from "./Money.tsx";
import type { TeamExtras } from "../types/wallet-types.ts";

/**
 * SplitPreview — how the NEXT payout divides, worked all the way through.
 *
 * A team vault's central question is not "what is the balance" but "what do I get". So this renders
 * the whole waterfall as one proportion bar — platform fee, then the vault's cut, then each
 * member's share — followed by the same division as figures.
 *
 * Every number comes from the server's `previewShares` / `previewFee` / `previewVault`. The client
 * does not re-derive a single share (RULE D-1): split arithmetic is the one place where a rounding
 * difference between two implementations becomes a dispute between two people.
 */
export interface SplitPreviewProps {
	team: TeamExtras;
}

/** The rule's plain name. A code is not a label, and the server's `label` may be absent. */
function ruleLabel(rule: TeamExtras["splitRule"]): string {
	if (rule.label) return rule.label;
	switch (rule.ruleType) {
		case "co_op":
			return "Co-op · equal shares";
		case "finders_fee":
			return "Finder's fee";
		case "benevolent_dictator":
			return "Benevolent dictator";
	}
}

export function SplitPreview(props: SplitPreviewProps): JSX.Element {
	const rule = props.team.splitRule;
	const gross = rule.previewGross;
	const total = gross?.minor ?? 0;

	/** A display ratio over money the server already divided — legal, and never a re-derivation. */
	const pct = (minor: number) => (total > 0 ? (minor / total) * 100 : 0);

	const feePct = pct(rule.previewFee?.minor ?? 0);
	const vaultPct = pct(rule.previewVault?.minor ?? 0);

	return (
		<section class="wlt-split" aria-labelledby="wlt-split-title">
			<header class="wlt-split__head">
				<h3 class="wlt-split__title wlt-label" id="wlt-split-title">Next payout</h3>
				<span class="wlt-split__rule">{ruleLabel(rule)}</span>
			</header>

			{gross && (
				<p class="wlt-split__gross">
					<Money value={gross} size="figure" showFx={false} />
					<span class="wlt-split__gross-label">gross</span>
				</p>
			)}

			<div class="wlt-split__bar" role="img" aria-label="How the next payout divides">
				{rule.previewFee && (
					<span
						class="wlt-split__seg wlt-split__seg--fee"
						style={styleVars({ "--wlt-seg": feePct })}
					/>
				)}
				{rule.previewVault && (
					<span
						class="wlt-split__seg wlt-split__seg--vault"
						style={styleVars({ "--wlt-seg": vaultPct })}
					/>
				)}
				{rule.previewShares.map((share, i) => (
					<span
						key={`${share.handle ?? share.name}-${i}`}
						class="wlt-split__seg wlt-split__seg--share"
						style={styleVars({ "--wlt-seg": pct(share.amount.minor), "--wlt-i": i })}
					/>
				))}
			</div>

			<ul class="wlt-split__legend" role="list">
				{rule.previewFee && (
					<li class="wlt-split__row" data-kind="fee">
						<span class="wlt-split__who">Platform service fee</span>
						<span class="wlt-split__bp wlt-num">5%</span>
						<span class="wlt-split__amount">
							<Money value={rule.previewFee} size="body" tone="fee" showFx={false} />
						</span>
					</li>
				)}
				{rule.previewVault && (
					<li class="wlt-split__row" data-kind="vault">
						<span class="wlt-split__who">Retained by the vault</span>
						<span class="wlt-split__bp wlt-num">{(rule.vaultBp / 100).toFixed(0)}%</span>
						<span class="wlt-split__amount">
							<Money value={rule.previewVault} size="body" showFx={false} />
						</span>
					</li>
				)}
				{rule.previewShares.map((share, i) => (
					<li class="wlt-split__row" key={`${share.handle ?? share.name}-${i}`}>
						<span class="wlt-split__who">
							{share.handle
								? <a class="wlt-link" href={`/@${share.handle}`}>{share.name}</a>
								: share.name}
							{rule.finderHandle && share.handle === rule.finderHandle && (
								<span class="wlt-split__tag">finder</span>
							)}
						</span>
						<span class="wlt-split__bp wlt-num">{(share.shareBp / 100).toFixed(1)}%</span>
						<span class="wlt-split__amount">
							<Money value={share.amount} size="body" showFx={false} />
						</span>
					</li>
				))}
			</ul>
		</section>
	);
}
