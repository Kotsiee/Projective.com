import type { JSX } from "preact";
import { useComputed, useSignal } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import { Dialog } from "@projective/ui/feedback";
import { Icon } from "@projective/ui/icons";
import "../styles/service-booking.css";
import { CtaButton } from "../components/CtaButton.tsx";
import { useCtaFeedback } from "../core/cta-feedback.ts";
import { commitContact } from "../core/booking-commits.ts";
import {
	clearSimulationOutcome,
	SIMULATED_COMMIT_LABEL,
	SIMULATED_SETTLED_LABEL,
	simulating,
} from "../core/simulation.ts";
import { SimulationOutcome } from "../components/SimulationNotices.tsx";
import { announce, closeBookingPanel, currentOffer, openPanel } from "../core/booking-state.ts";
import {
	type IntakeField,
	intakePriceAdjustment,
	type ServiceBookingOffer,
} from "@projective/types/services";
import { FormControl, InputText, NumberInput, Textarea } from "@projective/ui/fields";
import { toMinorUnits } from "@projective/types/finance";
import { MONEY_FIELD, moneyDigits } from "@web/utils/money-field.ts";
import { displayLocale, MoneyView } from "@projective/ui/display/money";
import { IntakeFields } from "@web/features/profile/components/hire/IntakeFields.tsx";
import type { OfferSummary } from "../core/offer-summary.ts";
import { BUDGET_PLACEHOLDER, quotePlaceholder } from "../core/quote-placeholder.ts";
import { useIntakeAnswers } from "../hooks/useIntakeAnswers.ts";

/**
 * QuoteRequestModal — the Contact menu's **Request a custom quote**.
 *
 * A scope proposal against the service blueprint: what the buyer needs, roughly what they have to
 * spend, and roughly when. It creates no project, no stage, no ticket and no escrow — it is a
 * structured message, and the provider answers it with a real price.
 *
 * # The budget is soft, and the interface says so
 *
 * A service's price is provider-set (`PRODUCT_SPEC.md` §Why Sessions are Fixed), so this figure is
 * "here is what I have in mind", never a counter-offer. It is **optional** for the same reason: "I
 * don't know yet, what would this cost?" is a legitimate first message, and forcing a number out of
 * somebody who has none produces a fictional one that then anchors the conversation.
 *
 * # Currency travels with the amount
 *
 * The field pair is validated together — a budget with no currency is refused before the request goes
 * anywhere. An amount quoted currency-less is not a smaller fact than a wrong one; it is a fact whose
 * reader has to guess, and the two parties are frequently in different countries.
 *
 * # The seller's own questions
 *
 * The listing's questions are asked here too (Decision #522), held to the rule the server enforces, so
 * the seller prices against the same answers a booking would carry; follow-ups open under the answer
 * that reveals them. Where the seller priced a number question, the footer states the guide their own
 * rates give for these answers. It is a guide: the price is the one in their offer.
 */
export interface QuoteRequestModalProps {
	offer: ServiceBookingOffer;
	/** The listing's own currency, pre-filling the budget field so the common case needs no thought. */
	currency?: string;
	/** The listing as the page names it; its price is the budget field's placeholder. */
	summary?: OfferSummary;
	/** The seller's own questions, asked beside the scope. */
	intake?: readonly IntakeField[];
}

const SCOPE_MAX = 4000;
const TIMELINE_MAX = 200;

export default function QuoteRequestModal(
	{ offer: ssrOffer, currency = "USD", summary, intake = [] }: QuoteRequestModalProps,
): JSX.Element {
	const bodyRef = useRef<HTMLDivElement>(null);
	const intakeState = useIntakeAnswers(intake, bodyRef);
	const guide = useComputed(() => {
		const adjustment = intakePriceAdjustment(intake, intakeState.answers.value);
		const base = summary?.price.amount;
		if (adjustment === null || !base || base.currency !== currency) return null;
		return { minor: Math.max(0, base.minor + adjustment), currency, isFloor: summary?.price.isFloor ?? false };
	});
	const offer = useComputed(() => currentOffer.value ?? ssrOffer);
	const open = useComputed(() => openPanel.value === "quote");

	const scope = useSignal("");
	/** Integer MINOR units, from the whole units typed in the budget field; `null` = no budget given. */
	const budget = useSignal<number | null>(null);
	/** The budget field's own value, in whole units of the listing's currency. */
	const budgetField = useSignal<number | null>(null);
	const timeline = useSignal("");
	const error = useSignal<string | null>(null);
	const cta = useCtaFeedback();

	useEffect(() => {
		if (open.value) {
			clearSimulationOutcome();
			return;
		}
		scope.value = "";
		budget.value = null;
		budgetField.value = null;
		timeline.value = "";
		error.value = null;
		intakeState.reset();
		cta.reset();
	}, [open.value]);

	async function submit(): Promise<boolean> {
		const text = scope.value.trim();
		if (!text) {
			error.value = "Describe what you need.";
			return false;
		}
		// `null` stays "I did not say", never £0 — a real, and very different, offer.
		const budgetMinor = budget.value ?? undefined;
		if (budgetMinor !== undefined && budgetMinor < 0) {
			error.value = "A budget cannot be negative.";
			return false;
		}
		error.value = null;
		if (!intakeState.check()) return false;

		const out = await commitContact({
			kind: "custom_quote",
			handle: offer.value.contact.handle,
			subjectId: offer.value.subjectId,
			scope: text,
			budgetMinor,
			currency: budgetMinor === undefined ? undefined : currency,
			timeline: timeline.value.trim() || undefined,
			answers: intakeState.answers.value,
		});
		// A simulated request stays open on its outcome: nothing was sent, so nothing closes.
		if (out.simulated) return true;
		const res = out.value;
		if (!res.ok || !res.data) {
			if (intakeState.fromServer(res.message, res.errors)) return false;
			error.value = res.message ?? "Could not send that request.";
			return false;
		}
		announce(res.data.result.confirmation);
		// Resolves in place. A quote has no thread yet — the provider's reply creates one — so navigating
		// anywhere would land the buyer on an empty conversation.
		setTimeout(() => closeBookingPanel(), 1200);
		return true;
	}

	return (
		<Dialog
			visible={open}
			onVisibleChange={(next) => {
				if (!next) closeBookingPanel();
			}}
			header={`Request a quote from ${offer.value.contact.sellerName}`}
			width="min(36rem, 94vw)"
			class="sbk sbk--quote"
			footer={
				<div class="sbk__footer">
					<p class="sbk__summarynote" aria-live="polite">
						{guide.value
							? (
								<>
									Their rates for your answers: {guide.value.isFloor ? "from " : "about "}
									<MoneyView minor={guide.value.minor} currency={guide.value.currency} size="micro" />. Their offer sets the price.
								</>
							)
							: "They reply with a scope and a price. Nothing is committed."}
					</p>
					<CtaButton
						label={simulating.value ? SIMULATED_COMMIT_LABEL : "Send request"}
						settledLabel={simulating.value ? SIMULATED_SETTLED_LABEL : "Sent"}
						phase={cta.phase}
						disabled={!scope.value.trim()}
						icon={<Icon name="send" size="sm" aria-hidden />}
						fluid={false}
						onClick={() => void cta.run(submit)}
					/>
				</div>
			}
		>
			<div class="sbk__body" ref={bodyRef}>
				<p class="sbk__about">
					About <span class="sbk__aboutitem">{offer.value.subjectTitle}</span>
				</p>

				<FormControl label="What do you need?" required collapseHint>
					{(a) => (
						<Textarea
							id={a.id}
							aria-describedby={a.describedBy}
							value={scope}
							rows={5}
							maxRows={12}
							autoResize
							required
							maxLength={SCOPE_MAX}
								placeholder="The outcome you're after, what's in and out of scope, and anything that differs from the listing"
								fluid
							/>
						)}
					</FormControl>

					{intake.length > 0 && (
						<section class="sbk__section" aria-labelledby="sbk-quote-intake-label">
							<h3 class="sbk__sectiontitle" id="sbk-quote-intake-label">
								{offer.value.contact.sellerName} asks
							</h3>
							<IntakeFields
								fields={intake}
								answers={intakeState.answers}
								refusal={intakeState.refusal()}
								idPrefix="sbk-quote-intake"
							/>
						</section>
					)}

				<div class="sbk__row">
					<FormControl
						label="Rough budget (optional)"
						hint="A guide, not an offer — they set the price."
						class="sbk__field"
						collapseHint
					>
						{(a) => (
							<NumberInput
								{...MONEY_FIELD}
								{...moneyDigits(currency)}
								id={a.id}
								aria-describedby={a.describedBy}
								value={budgetField}
								placeholder={summary
									? quotePlaceholder(summary.price, currency, displayLocale.value || undefined)
									: BUDGET_PLACEHOLDER}
								fluid
								onValueChange={(whole) => (budget.value = toMinorUnits(whole, currency))}
							/>
						)}
					</FormControl>

					<FormControl label="When do you need it? (optional)" class="sbk__field" collapseHint>
						{(a) => (
							<InputText
								id={a.id}
								aria-describedby={a.describedBy}
								value={timeline}
								placeholder="Before our launch in March"
								maxLength={TIMELINE_MAX}
								fluid
							/>
						)}
					</FormControl>
				</div>

				{error.value && <p class="sbk__error" role="alert">{error.value}</p>}
				{simulating.value && <SimulationOutcome />}
			</div>
		</Dialog>
	);
}
