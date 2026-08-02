import type { JSX } from "preact";
import { Icon, type IconName } from "@projective/ui/icons";
import type { BoardCard, TicketPaymentKind } from "../../../types/projects-types.ts";
import {
	formatTicketMoney,
	TICKET_INTENSITY_LABEL,
	ticketCostLines,
} from "../../../types/projects-types.ts";
import { multiplierLabel } from "../../../core/ticket-view.ts";

/**
 * TicketFinanceTab — where the ticket's price comes from, and where the money has actually gone.
 *
 * Two sections that answer two different questions and are never merged. The **breakdown** shows the
 * arithmetic: each stage's base rate, the multiplier the chosen intensity resolves to, and the
 * product. This is the ONE place in the product a multiplier appears as a number — everywhere else
 * intensity is Low/Standard/High, because a badge reading "High ×2" states a conclusion the reader
 * cannot check, whereas a row reading `$300 × 2 = $600` is the check.
 *
 * The **movements** section is the audit history: what has been held, adjusted, charged and
 * released. An unpriced stage renders as "No rate", never as $0 — a price nobody has set and a price
 * of nothing are different facts, and a total that silently absorbs the first is a lie.
 */
export interface TicketFinanceTabProps {
	card: BoardCard;
}

const MOVEMENT_ICON: Record<TicketPaymentKind, IconName> = {
	hold: "lock",
	release: "check",
	fee: "tag",
	refund: "refresh",
	adjustment: "switch",
};

/** A signed movement reads with its sign, so a fee is visibly money leaving. */
function signedMoney(cents: number): string {
	if (cents === 0) return "—";
	return `${cents < 0 ? "−" : "+"}${formatTicketMoney(Math.abs(cents))}`;
}

export function TicketFinanceTab(props: TicketFinanceTabProps): JSX.Element {
	const { card } = props;
	const lines = ticketCostLines(card.stages);
	const unpriced = lines.filter((l) => l.costCents === null).length;

	return (
		<div class="tkv-fin">
			<section class="tkv-doc__sec" aria-label="Cost breakdown">
				<h3 class="tkv-h">
					How this price is made
					<span class="tkv-h__note">
						Base stage rate × the intensity chosen for that stage
					</span>
				</h3>

				{lines.length === 0
					? (
						<p class="tkv-empty tkv-empty--inline">
							No stages are selected, so this ticket has no price.
						</p>
					)
					: (
						<table class="tkv-table">
							<caption class="tkv-sr">Stage cost breakdown</caption>
							<thead>
								<tr>
									<th scope="col">Stage</th>
									<th scope="col">Intensity</th>
									<th scope="col" class="tkv-table__num">Base rate</th>
									<th scope="col" class="tkv-table__num">Multiplier</th>
									<th scope="col" class="tkv-table__num">Cost</th>
								</tr>
							</thead>
							<tbody>
								{lines.map((l) => (
									<tr key={l.stageId}>
										<th scope="row" class="tkv-table__name">{l.name}</th>
										<td>
											<span class="tkv-chip" data-level={l.intensity}>
												{TICKET_INTENSITY_LABEL[l.intensity]}
											</span>
										</td>
										<td class="tkv-table__num">
											{l.baseCents === null
												? <span class="tkv-table__none">No rate</span>
												: formatTicketMoney(l.baseCents)}
										</td>
										<td class="tkv-table__num tkv-table__mult">{multiplierLabel(l.multiplier)}</td>
										<td class="tkv-table__num tkv-table__total">
											{l.costCents === null
												? <span class="tkv-table__none">—</span>
												: formatTicketMoney(l.costCents)}
										</td>
									</tr>
								))}
							</tbody>
							<tfoot>
								<tr>
									<th scope="row" colSpan={4}>Ticket total</th>
									<td class="tkv-table__num tkv-table__grand">
										{card.budgetCents === null ? "Not priced" : formatTicketMoney(card.budgetCents)}
									</td>
								</tr>
							</tfoot>
						</table>
					)}

				{unpriced > 0
					? (
						<p class="tkv-note" role="status">
							<Icon name="info" size="2xs" />
							{unpriced} {unpriced === 1 ? "stage has" : "stages have"}{" "}
							no ticket rate yet, so this total is partial.
						</p>
					)
					: null}

				<dl class="tkv-facts tkv-facts--inline">
					<div class="tkv-facts__row">
						<dt>Capacity consumed</dt>
						<dd>
							W {card.workload}
							<span class="tkv-facts__note">
								summed across this ticket's stages
							</span>
						</dd>
					</div>
					<div class="tkv-facts__row">
						<dt>Escrow</dt>
						<dd>
							{card.escrowHeld
								? "Held against this ticket"
								: card.status === "completed"
								? "Released on approval"
								: "Not yet held — escrow starts at claim"}
						</dd>
					</div>
				</dl>
			</section>

			<section class="tkv-doc__sec" aria-label="Payment history">
				<h3 class="tkv-h">Movements</h3>
				{card.payments.length === 0
					? (
						<p class="tkv-empty tkv-empty--inline">
							No money has moved on this ticket yet. Escrow is held when a freelancer claims it.
						</p>
					)
					: (
						<ol class="tkv-ledger">
							{card.payments.map((p) => (
								<li key={p.id} class="tkv-ledger__row" data-kind={p.kind}>
									<span class="tkv-ledger__mark" aria-hidden="true">
										<Icon name={MOVEMENT_ICON[p.kind]} size="2xs" />
									</span>
									<span class="tkv-ledger__body">
										<span class="tkv-ledger__label">{p.label}</span>
										<span class="tkv-ledger__meta">
											{p.party ? `${p.party.name} · ` : ""}
											{p.dateLabel}
										</span>
									</span>
									<span class="tkv-ledger__state" data-state={p.state}>{p.state}</span>
									<span class="tkv-ledger__amount" data-negative={p.amountCents < 0 || undefined}>
										{signedMoney(p.amountCents)}
									</span>
								</li>
							))}
						</ol>
					)}
			</section>
		</div>
	);
}
