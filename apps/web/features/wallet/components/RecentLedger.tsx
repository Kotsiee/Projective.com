import type { JSX } from "preact";
import { Tooltip } from "@projective/ui/feedback";
import { ForwardGlyph } from "../core/glyphs.tsx";
import { FundStateDot, fundStateLabel } from "./FundStateMark.tsx";
import { Money } from "./Money.tsx";
import { EmptyBand } from "./band-parts.tsx";
import { isDisputeReason, reasonLabel } from "../core/ledger-model.ts";
import { fundFilter } from "../core/wallet-state.ts";
import type { FundState, LedgerLine } from "../types/wallet-types.ts";

/**
 * RecentLedger — the eight most recent movements.
 *
 * Two rules from the design system do real work here:
 *
 *  - **§B.6**: the fund state is a DOT with a portal tooltip, never inline status text. Eight rows
 *    each carrying the word "Available" would be eight repetitions of the least interesting fact
 *    on the row.
 *  - **RULE C-1**: a debit is `--wlt-debit` (neutral), not red. Only a genuine dispute earns the
 *    danger tone, and it earns it on a CHIP — the amount itself stays legible, because the money is
 *    not what is wrong.
 *
 * "See all" is a text link, not a button: it navigates within the same dataset, which is the one
 * navigational affordance the body is allowed (§4.5 RULE R-1).
 */
export interface RecentLedgerProps {
	lines: LedgerLine[];
	total: number;
	scope: string;
	display: string;
	/** The fund state selected in the hero's capital meter, if any. */
	filter?: FundState | null;
}

export function RecentLedger(props: RecentLedgerProps): JSX.Element {
	const filter = props.filter ?? null;
	const lines = filter ? props.lines.filter((l) => l.fundState === filter) : props.lines;

	const allHref = `/wallet/transactions?w=${encodeURIComponent(props.scope)}` +
		(filter ? `&fundState=${filter}` : "");

	return (
		<div class="wlt-recent">
			{filter && (
				<p class="wlt-recent__filter">
					Showing {fundStateLabel(filter).toLowerCase()} ·{" "}
					<a
						class="wlt-link"
						href="/wallet"
						onClick={(e) => {
							e.preventDefault();
							fundFilter.value = null;
						}}
					>
						show all
					</a>
				</p>
			)}

			{lines.length === 0
				? (
					<EmptyBand
						text={filter ? "Nothing in this state yet." : "No transactions yet."}
						hint={filter
							? undefined
							: "Movements appear as escrow funds, releases and payouts settle."}
					/>
				)
				: (
					<ul class="wlt-recent__list" role="list">
						{lines.map((line) => {
							const dispute = isDisputeReason(line.reason);
							const body = (
								<>
									<span class="wlt-recent__dir" data-dir={line.direction} aria-hidden="true" />
									<span class="wlt-recent__body">
										<span class="wlt-recent__title">{line.title}</span>
										<span class="wlt-recent__counterparty">
											{line.counterparty ?? reasonLabel(line.reason)}
										</span>
									</span>
									{dispute && <span class="wlt-recent__chip">{reasonLabel(line.reason)}</span>}
									<Tooltip content={fundStateLabel(line.fundState)} placement="top">
										<span
											class="wlt-recent__state"
											role="img"
											aria-label={fundStateLabel(line.fundState)}
										>
											<FundStateDot state={line.fundState} />
										</span>
									</Tooltip>
									<span class="wlt-recent__amount">
										<Money
											value={line.amount}
											size="body"
											tone={line.direction === "credit" ? "credit" : "debit"}
											sign={line.direction === "credit" ? "+" : "−"}
											showFx={false}
										/>
									</span>
									<span class="wlt-recent__date">{line.dateLabel}</span>
								</>
							);
							return (
								<li class="wlt-recent__row" key={line.id}>
									{line.href
										? <a class="wlt-recent__link" href={line.href}>{body}</a>
										: <div class="wlt-recent__link">{body}</div>}
								</li>
							);
						})}
					</ul>
				)}

			{/* The overview has no ledger count, so the link never claims one it was not given. */}
			<a class="wlt-recent__seeall" href={allHref}>
				See all {props.total > 0 ? `${props.total} ` : ""}transactions
				<span class="wlt-recent__seeall-glyph">{ForwardGlyph}</span>
			</a>
		</div>
	);
}
