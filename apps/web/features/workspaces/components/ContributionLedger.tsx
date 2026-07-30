import type { JSX } from "preact";
import { Avatar } from "@projective/ui/display";
import { Tooltip } from "@projective/ui/feedback";
import type { PoolEntry } from "@projective/types/workspace";
import { PolicyAmount } from "./PolicyAmount.tsx";
import { cloneGlyph, SpendGlyph, WalletGlyph } from "../core/workspace-glyphs.tsx";

/**
 * ContributionLedger — every movement into and out of the pooled wallet, attributed to a person.
 *
 * **Attribution is the whole feature.** A shared company wallet that shows only a balance is a dispute
 * waiting to happen: when four people fund it and six spend from it, "where did the money go" has to
 * be answerable without anyone's memory. So each line names who, how much, what for, when, and — when
 * an approval was needed — who granted it.
 *
 * Direction is carried by a GLYPH and the sign, not by colour alone: a red/green ledger is unreadable
 * to a large minority of people and says nothing at all in print.
 */

export interface ContributionLedgerProps {
	entries: readonly PoolEntry[];
	/** Cap the list — the policy page shows a recent window and links onward for the rest. */
	limit?: number;
}

/** The attributable pooled-wallet ledger. */
export function ContributionLedger(props: ContributionLedgerProps): JSX.Element {
	const entries = props.limit ? props.entries.slice(0, props.limit) : props.entries;

	if (entries.length === 0) {
		return (
			<p class="wsp-pagehead__meta">
				Nothing has moved through the pooled wallet yet. Contributions and purchases will appear
				here, each against the person who made them.
			</p>
		);
	}

	return (
		<ul class="wsp-pool" aria-label="Contributions and spending">
			{entries.map((entry) => {
				const inbound = entry.kind === "contribution";
				return (
					<li class="wsp-pool__item" key={entry.id} data-kind={entry.kind}>
						<Tooltip
							content={inbound ? "Contribution into the pool" : "Spent from the pool"}
							placement="right"
						>
							<span
								class="wsp-pool__glyph"
								role="img"
								aria-label={inbound ? "Contribution" : "Spend"}
							>
								{cloneGlyph(inbound ? WalletGlyph : SpendGlyph)}
							</span>
						</Tooltip>

						<Avatar
							class="wsp-pool__avatar"
							image={entry.avatar}
							alt=""
							label={entry.name}
							shape="circle"
							size="sm"
						/>

						<span class="wsp-pool__body">
							<span class="wsp-pool__who">
								<a href={`/@${entry.handle}`}>{entry.name}</a>
							</span>
							<span class="wsp-pool__reason">{entry.reason}</span>
						</span>

						<span class="wsp-pool__amount" data-direction={inbound ? "in" : "out"}>
							<PolicyAmount
								value={entry.amount}
								size="key"
								srLabel={`${inbound ? "Contributed" : "Spent"} by ${entry.name}`}
							/>
						</span>

						<span class="wsp-pool__at">{entry.at}</span>

						{entry.approvedBy && (
							<Tooltip content={`Approved by ${entry.approvedBy}`} placement="left">
								<span class="wsp-pool__approved">Approved</span>
							</Tooltip>
						)}
					</li>
				);
			})}
		</ul>
	);
}
