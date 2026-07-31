import type { JSX } from "preact";
import "../styles/wallet.css";
import { Drawer } from "@projective/ui/feedback";
import { Button } from "@projective/ui/fields";
import { fundStateLabel, FundStateMark } from "../components/FundStateMark.tsx";
import { Money } from "../components/Money.tsx";
import { categoryLabel, isDisputeReason, reasonLabel, refLabel } from "../core/ledger-model.ts";
import { drawerLine } from "../core/wallet-state.ts";

/**
 * TransactionDrawer — one movement, decomposed.
 *
 * A right-docked drawer rather than a modal, because reading a transaction is a dialogue with the
 * ledger: the row you came from should stay visible behind it, and you should be able to close and
 * open the next one without losing your place.
 *
 * Two omissions are deliberate. There is **no dispute or reverse button** — neither flow is a
 * decided feature, and a button that promises a path we have not built is worse than its absence.
 * And a cross-currency line discloses exactly three facts (origin, converted, rate) with **no fee
 * line**, because who bears the FX spread is an open business question and a placeholder would be
 * fabricated policy.
 */
export default function TransactionDrawer(): JSX.Element | null {
	const line = drawerLine.value;
	if (!line) return null;

	const dispute = isDisputeReason(line.reason);
	const ref = refLabel(line);

	return (
		<Drawer
			visible
			position="right"
			class="wlt-drawer"
			header={line.title}
			closable
			onVisibleChange={(v) => {
				if (!v) drawerLine.value = null;
			}}
		>
			<div class="wlt-drawer__body">
				<p class="wlt-drawer__figure">
					<Money
						value={line.amount}
						size="figure"
						tone={line.direction === "credit" ? "credit" : "debit"}
						sign={line.direction === "credit" ? "+" : "−"}
					/>
				</p>

				<section class="wlt-drawer__section">
					<h3 class="wlt-drawer__sectitle wlt-label">What this is</h3>
					<p class="wlt-prose">
						{reasonLabel(line.reason)}
						{line.counterparty ? ` with ${line.counterparty}` : ""}.
						{dispute
							? " This movement is contested and is being reviewed."
							: line.fundState === "locked"
							? " The money is held in escrow against an active stage."
							: line.fundState === "pending"
							? " Released, and clearing through the 7-day safety window."
							: ""}
					</p>
				</section>

				<section class="wlt-drawer__section">
					<h3 class="wlt-drawer__sectitle wlt-label">Details</h3>
					<dl class="wlt-facts">
						<div class="wlt-facts__row">
							<dt class="wlt-facts__label">State</dt>
							<dd class="wlt-facts__value wlt-drawer__state">
								<FundStateMark state={line.fundState} />
								{fundStateLabel(line.fundState)}
							</dd>
						</div>
						<div class="wlt-facts__row">
							<dt class="wlt-facts__label">Category</dt>
							<dd class="wlt-facts__value">{categoryLabel(line.category)}</dd>
						</div>
						<div class="wlt-facts__row">
							<dt class="wlt-facts__label">Date</dt>
							<dd class="wlt-facts__value">{line.dateLabel}</dd>
						</div>
						{line.counterpartyHandle && (
							<div class="wlt-facts__row">
								<dt class="wlt-facts__label">Counterparty</dt>
								<dd class="wlt-facts__value">
									<a class="wlt-link" href={`/@${line.counterpartyHandle}`}>
										@{line.counterpartyHandle}
									</a>
								</dd>
							</div>
						)}
						<div class="wlt-facts__row">
							<dt class="wlt-facts__label">Reference</dt>
							<dd class="wlt-facts__value wlt-num">{line.id}</dd>
						</div>
					</dl>
				</section>

				{line.reason === "escrow_release" && (
					<section class="wlt-drawer__section">
						<h3 class="wlt-drawer__sectitle wlt-label">Platform fee</h3>
						<p class="wlt-prose">
							A flat 5% service fee applies at escrow release. It does not change with your Standing
							rung.
						</p>
					</section>
				)}

				{line.amount.origin && (
					<section class="wlt-drawer__section">
						<h3 class="wlt-drawer__sectitle wlt-label">Currency</h3>
						<dl class="wlt-facts">
							<div class="wlt-facts__row">
								<dt class="wlt-facts__label">Priced in</dt>
								<dd class="wlt-facts__value">{line.amount.origin.display}</dd>
							</div>
							<div class="wlt-facts__row">
								<dt class="wlt-facts__label">Shown as</dt>
								<dd class="wlt-facts__value">{line.amount.display}</dd>
							</div>
							<div class="wlt-facts__row">
								<dt class="wlt-facts__label">Rate</dt>
								<dd class="wlt-facts__value wlt-num">
									1 {line.amount.origin.currency.toUpperCase()} ={" "}
									{line.amount.origin.fxRate.toFixed(4)} {line.amount.currency}
								</dd>
							</div>
						</dl>
					</section>
				)}
			</div>

			<footer class="wlt-drawer__foot">
				{
					/* This drawer only READS a movement, so it has no primary: a link out to the source and
				    the escape hatch, both at low weight (§B.8.1). A `filled` Close would claim the panel
				    was asking something. */
				}
				{ref && line.href && <a class="wlt-link" href={line.href}>{ref}</a>}
				<Button
					variant="text"
					label="Close"
					onClick={() => {
						drawerLine.value = null;
					}}
				/>
			</footer>
		</Drawer>
	);
}
