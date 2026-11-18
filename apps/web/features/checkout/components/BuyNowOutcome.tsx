import type { JSX, Ref } from "preact";
import { Icon } from "@projective/ui/icons";
import { useMaskFigures } from "@projective/ui/utils/screen-share";
import { StripeElementPanel } from "@features/payments/components/StripeElementPanel.tsx";
import { refusalLines } from "../core/business-gate.ts";
import { Amount } from "./Amount.tsx";
import type { CheckoutResult, CheckoutSessionContext } from "../types/checkout-types.ts";

/** Props for {@link BuyNowOutcome}. */
export interface BuyNowOutcomeProps {
	/** The attempt's answer. */
	result: CheckoutResult;
	/** The session the attempt was made against — the refusal map words a business refusal from it. */
	view: CheckoutSessionContext | null;
	/** A card charge is confirmed and its wallet credit is awaited. */
	settling: boolean;
	/** A write is in flight, so the card panel's own Pay holds. */
	busy: boolean;
	/** Stripe confirmed a card entered in the panel. */
	onCardConfirmed: (paymentId: string) => void;
	/** The region focus is handed to when the outcome replaces the commit. */
	regionRef?: Ref<HTMLDivElement>;
}

/**
 * BuyNowOutcome — what a Buy-now attempt came to, in the modal's left column: the outcome's mark and
 * sentence, the amount charged, the card panel a `collect` hand-off needs, and every reason a refusal
 * gave. A refusal interrupts (`role="alert"`); every other outcome is a status.
 */
export function BuyNowOutcome(props: BuyNowOutcomeProps): JSX.Element {
	const { result } = props;
	const mask = useMaskFigures();
	const lines = refusalLines(result, props.view);
	const payment = result.status === "requires_action" ? result.payment : undefined;

	return (
		<div
			class="bnow__result"
			data-status={result.status}
			role={result.status === "failed" ? "alert" : "status"}
			tabIndex={-1}
			ref={props.regionRef}
		>
			<Icon
				name={result.status === "succeeded"
					? "success"
					: result.status === "failed"
					? "error"
					: "hourglass"}
				size="xl"
			/>
			<p class="bnow__result-msg">{lines.headline}</p>
			{result.status === "succeeded" && (
				<p class="bnow__result-amount">
					<Amount value={result.charged} size="hero" />
				</p>
			)}
			{payment
				? props.settling || payment.confirmation !== "collect"
					? <p class="bnow__pending" role="status">Confirming the payment with your bank…</p>
					: (
						<StripeElementPanel
							mode="payment"
							clientSecret={payment.clientSecret}
							publishableKey={payment.publishableKey}
							submitLabel={`Pay ${mask(payment.amount.display)}`}
							busy={props.busy}
							onOutcome={(outcome) => {
								if (outcome.ok) props.onCardConfirmed(payment.paymentId);
							}}
						/>
					)
				: result.nextActionUrl
				? (
					<a class="bnow__next" href={result.nextActionUrl} rel="noopener noreferrer">
						Continue
					</a>
				)
				: null}
			{lines.reasons.map(({ blocker, sentence }) => (
				<p key={`${blocker.code}-${blocker.itemId ?? "account"}`} class="bnow__blocker">
					<Icon name="warning" size="sm" />
					<span>{sentence}</span>
				</p>
			))}
		</div>
	);
}
