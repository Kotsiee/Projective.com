import type { JSX } from "preact";
import { MoneyView } from "@projective/ui/display/money";
import { Icon } from "@projective/ui/icons";
import type { CalendarEvent } from "@projective/types/scheduling";

/**
 * EventFinanceTab — what this occurrence is worth to the person running it.
 *
 * Provider-side only, and absent rather than locked for anyone else (the tab is filtered out at
 * {@link eventTabs}): these are the HOST's earnings, and a buyer opening a tab to be told they may not
 * read it is a capability advertised and then refused. What a seat costs a buyer is in the footer,
 * where a buyer's money belongs.
 *
 * **Every figure arrives computed.** The client renders `MoneyView`s and never multiplies a seat price
 * by a head count — a rounded per-seat figure times a count does not reliably equal what will actually
 * be released, and a host reading a fabricated total is reading a promise nobody made. The one number
 * derived here is the seat COUNT, which is a head count and not money.
 *
 * A `free` occurrence says so in words. It never renders a zero, because "deliberately free" and "not
 * priced yet" are different facts and £0.00 states the second while meaning the first.
 */
export interface EventFinanceTabProps {
	event: CalendarEvent;
}

export function EventFinanceTab(props: EventFinanceTabProps): JSX.Element {
	const pricing = props.event.pricing;

	if (!pricing || pricing.model === "free") {
		return (
			<div class="evm-doc">
				<div class="evm-empty" role="status">
					<Icon name="wallet" size="lg" class="evm-empty__mark" />
					<p class="evm-empty__title">This one is free</p>
					<p class="evm-empty__note">
						A courtesy session carries no charge, so there is nothing to release and no fee to take.
					</p>
				</div>
			</div>
		);
	}

	const perSeat = pricing.model === "per_seat";
	const series = pricing.seriesEarnings;

	return (
		<div class="evm-doc">
			<section class="evm-doc__sec">
				<h3 class="evm-h">This occurrence</h3>
				<table class="evm-table">
					<thead>
						<tr>
							<th scope="col">What</th>
							<th scope="col" class="evm-table__num">Rate</th>
							<th scope="col" class="evm-table__num">Count</th>
							<th scope="col" class="evm-table__num">Total</th>
						</tr>
					</thead>
					<tbody>
						<tr>
							<th scope="row">{perSeat ? "Seats sold" : "Session fee"}</th>
							<td class="evm-table__num">
								{pricing.unitPrice
									? <MoneyView value={pricing.unitPrice} size="micro" />
									: <span class="evm-table__none">Not priced</span>}
							</td>
							<td class="evm-table__num">{perSeat ? pricing.paidSeats : 1}</td>
							<td class="evm-table__num">
								{pricing.occurrenceEarnings
									? <MoneyView value={pricing.occurrenceEarnings} size="micro" />
									: <span class="evm-table__none">Not priced</span>}
							</td>
						</tr>
					</tbody>
					<tfoot>
						<tr>
							<th scope="row" colSpan={3}>You earn from this occurrence</th>
							<td class="evm-table__num evm-table__grand">
								{pricing.occurrenceEarnings
									? <MoneyView value={pricing.occurrenceEarnings} size="key" />
									: <span class="evm-table__none">Not priced</span>}
							</td>
						</tr>
					</tfoot>
				</table>
			</section>

			{series && pricing.remainingOccurrences > 1
				? (
					<section class="evm-doc__sec">
						<h3 class="evm-h">
							The rest of the series
							<span class="evm-h__count">{pricing.remainingOccurrences} occurrences</span>
						</h3>
						<dl class="evm-facts">
							<div class="evm-facts__row">
								<dt>Still to run</dt>
								<dd>
									{pricing.remainingOccurrences}{" "}
									{pricing.remainingOccurrences === 1 ? "session" : "sessions"}, this one included
								</dd>
							</div>
							<div class="evm-facts__row">
								<dt>Total at today's roster</dt>
								<dd>
									<MoneyView value={series} size="body" />
								</dd>
							</div>
						</dl>
						<p class="evm-note">
							<Icon name="info" size="2xs" />
							A projection at the seats sold today, not a commitment — seats can still be booked or
							released.
						</p>
					</section>
				)
				: null}

			<p class="evm-note">
				<Icon name="info" size="2xs" />
				Gross, as the ledger will see it. The platform fee is taken on release, and the released
				amount lands in your wallet.
			</p>
		</div>
	);
}
