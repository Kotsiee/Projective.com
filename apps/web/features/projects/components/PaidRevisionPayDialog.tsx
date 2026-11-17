import type { JSX } from "preact";
import { type Signal, useSignal } from "@preact/signals";
import { useEffect } from "preact/hooks";
import { Button } from "@projective/ui/fields";
import { Alert, Dialog } from "@projective/ui/feedback";
import {
	type CardPaymentHandoff,
	formatMoney,
	type FundingCharge,
	type PaidRevisionFundingMethod,
} from "@projective/types/finance";
import { FundingConversion } from "@features/payments/components/FundingConversion.tsx";
import { StripeElementPanel } from "@features/payments/components/StripeElementPanel.tsx";
import { PaymentsService } from "@features/payments/core/PaymentsService.ts";
import type { PaidRevisionRaised } from "../types/projects-types.ts";
import { SettlementService } from "../core/SettlementService.ts";

/**
 * PaidRevisionPayDialog — how the client pays for a raised paid revision round (Decision #199):
 * **Pay from wallet** holds the round's escrow from the Available balance at once, **Pay by card**
 * mounts the Payment Element and waits for the signed webhook to hold it, and **Add to basket** hands
 * the round to Buy Now as a `paid_revision` line (Decision #167). The work goes back to the freelancer
 * only once the escrow is held, so the dialog reports success only after that. When the payer's billing
 * currency differs (Decision #436), it reads the round's charge in it on open and pays on the quote for
 * the route chosen, with what the round is listed at, the rate and the margin beneath.
 */
export interface PaidRevisionPayDialogProps {
	/** Visibility, owned by the caller (the shared overlay contract is signal-first). */
	open: Signal<boolean>;
	/** The raised round; `null` while none is being paid for. */
	round: PaidRevisionRaised | null;
	projectId: string;
	stageId: string | null;
	submissionId: string | null;
	onClose: () => void;
	/** The round's escrow is held and the work is back with the freelancer. */
	onFunded: (message: string) => void;
	/** Pay through the basket instead. */
	onAddToBasket: () => void;
}

type Step = "choose" | "starting" | "card" | "settling" | "waiting";

function attemptKey(): string {
	return `rev-${crypto.randomUUID()}`;
}

export function PaidRevisionPayDialog(props: PaidRevisionPayDialogProps): JSX.Element {
	const { open, round, projectId, stageId, submissionId, onClose, onFunded, onAddToBasket } = props;
	const step = useSignal<Step>("choose");
	const method = useSignal<PaidRevisionFundingMethod | null>(null);
	const handoff = useSignal<CardPaymentHandoff | null>(null);
	const error = useSignal<string | null>(null);
	const key = useSignal(attemptKey());
	const funding = useSignal<FundingCharge | null>(null);
	const reading = useSignal(false);

	async function readCharge(payIn: string | null = null): Promise<void> {
		if (!round || !stageId || !submissionId) return;
		reading.value = true;
		const res = await SettlementService.paidRevisionQuote(
			projectId,
			stageId,
			submissionId,
			round.revisionId,
			payIn,
		);
		reading.value = false;
		funding.value = res.ok && res.data ? res.data.funding : null;
	}

	useEffect(() => {
		if (!open.value) return;
		step.value = "choose";
		method.value = null;
		handoff.value = null;
		error.value = null;
		funding.value = null;
		key.value = attemptKey();
		void readCharge();
	}, [open.value, round?.revisionId]);

	const charge = funding.value?.charge ?? null;
	const price = charge?.display ?? (round ? formatMoney(round.priceMinor, round.currency) : "");
	const held = funding.value?.listed.display ?? price;
	const cardQuote = charge?.quote ? funding.value?.cardQuoteId ?? null : null;
	const cardBlocked = !!charge?.quote && !cardQuote;
	const busy = step.value === "starting" || step.value === "settling" || reading.value;

	async function pay(chosen: PaidRevisionFundingMethod): Promise<void> {
		if (!round || !stageId || !submissionId || busy) return;
		method.value = chosen;
		step.value = "starting";
		error.value = null;
		const res = await SettlementService.fundPaidRevision(projectId, stageId, submissionId, {
			revisionId: round.revisionId,
			method: chosen,
			expectedAmountMinor: round.priceMinor,
			currency: round.currency,
			fxQuoteId: chosen === "wallet" ? charge?.quote?.quoteId ?? null : cardQuote,
			idempotencyKey: key.value,
		});
		if (!res.ok || !res.data) {
			step.value = "choose";
			error.value = res.message ?? "That payment didn't go through — nothing was charged.";
			return;
		}
		if (res.data.method === "wallet") {
			onFunded(res.message ?? "Revision paid for — the work is back with the freelancer.");
			return;
		}
		handoff.value = res.data.handoff;
		step.value = "card";
	}

	async function settle(paymentId: string): Promise<void> {
		step.value = "settling";
		const { outcome, reason } = await PaymentsService.waitForLock(paymentId);
		if (outcome === "locked") {
			onFunded("Revision paid for by card — the work is back with the freelancer.");
			return;
		}
		if (outcome !== "timeout") {
			step.value = "choose";
			handoff.value = null;
			key.value = attemptKey();
			const why = reason ? `: ${reason.replace(/\.$/, "")}` : "";
			error.value = outcome === "declined"
				? `The card payment didn't go through${why}. Nothing was charged.`
				: `The payment arrived but the revision couldn't be funded${why}. The money is in your wallet — pay from it to try again.`;
			return;
		}
		step.value = "waiting";
		error.value = null;
	}

	const card = step.value === "card" ? handoff.value : null;
	const footer = step.value === "card" || step.value === "settling" || step.value === "waiting"
		? (
			<div class="subm-modal__actions">
				<Button label="Close" variant="text" severity="secondary" disabled={busy} onClick={onClose} />
			</div>
		)
		: (
			<div class="subm-modal__actions">
				<Button
					label="Add to basket"
					variant="text"
					severity="secondary"
					disabled={busy}
					onClick={onAddToBasket}
				/>
				<Button
					label="Pay by card"
					variant="outlined"
					disabled={busy || cardBlocked}
					loading={step.value === "starting" && method.value === "card"}
					onClick={() => void pay("card")}
				/>
				<Button
					label="Pay from wallet"
					variant="filled"
					severity="accent"
					rounded
					disabled={busy}
					loading={step.value === "starting" && method.value === "wallet"}
					onClick={() => void pay("wallet")}
				/>
			</div>
		);

	return (
		<Dialog
			visible={open}
			class="subm-modal"
			header={`Buy a revision · ${price}`}
			width="min(28rem, 100%)"
			closable={!busy}
			closeOnEscape={!busy}
			dismissableMask={!busy}
			onVisibleChange={(v) => !v && onClose()}
			footer={footer}
		>
			<p class="subm-modal__note">
				<strong>{held}</strong>{" "}
				is held in escrow on the ticket and released when you approve the revised work. The
				submission goes back to the freelancer once it is held.
			</p>
			{funding.value && step.value === "choose"
				? (
					<FundingConversion
						funding={funding.value}
						align="start"
						disabled={busy}
						onPayIn={(currency) => void readCharge(currency)}
					/>
				)
				: null}
			{error.value ? <Alert severity="danger">{error.value}</Alert> : null}
			{card
				? (
					<StripeElementPanel
						mode="payment"
						clientSecret={card.clientSecret}
						publishableKey={card.publishableKey}
						submitLabel={`Pay ${price}`}
						busy={busy}
						onOutcome={(outcome) => {
							if (outcome.ok) void settle(card.paymentId);
							else error.value = outcome.message;
						}}
					/>
				)
				: null}
			{step.value === "settling"
				? (
					<p class="subm-modal__note" role="status" aria-live="polite">
						Confirming the payment with your bank…
					</p>
				)
				: null}
			{step.value === "waiting"
				? (
					<p class="subm-modal__note" role="status" aria-live="polite">
						Your bank accepted the payment, but it hasn't reached your wallet yet. The revision
						opens and the freelancer is told as soon as it does — you can close this.
					</p>
				)
				: null}
		</Dialog>
	);
}
