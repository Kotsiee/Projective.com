import type { JSX } from "preact";
import { useComputed, useSignal } from "@preact/signals";
import { useEffect } from "preact/hooks";
import { Dialog } from "@projective/ui/feedback";
import { Icon } from "@projective/ui/icons";
import "../styles/service-booking.css";
import { CtaButton } from "../components/CtaButton.tsx";
import { useCtaFeedback } from "../core/cta-feedback.ts";
import { BookingService } from "../core/BookingService.ts";
import { bookingSim } from "../core/booking-seam.ts";
import { announce, closeBookingPanel, currentOffer, openPanel } from "../core/booking-state.ts";
import type { ServiceBookingOffer } from "@projective/types/services";

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
 */
export interface QuoteRequestModalProps {
	offer: ServiceBookingOffer;
	/** The listing's own currency, pre-filling the budget field so the common case needs no thought. */
	currency?: string;
}

export default function QuoteRequestModal(
	{ offer: ssrOffer, currency = "USD" }: QuoteRequestModalProps,
): JSX.Element {
	const offer = useComputed(() => currentOffer.value ?? ssrOffer);
	const open = useComputed(() => openPanel.value === "quote");

	const scope = useSignal("");
	const budget = useSignal("");
	const timeline = useSignal("");
	const error = useSignal<string | null>(null);
	const cta = useCtaFeedback();

	useEffect(() => {
		if (open.value) return;
		scope.value = "";
		budget.value = "";
		timeline.value = "";
		error.value = null;
		cta.reset();
	}, [open.value]);

	async function submit(): Promise<boolean> {
		const text = scope.value.trim();
		if (!text) {
			error.value = "Describe what you need.";
			return false;
		}
		/*
		 * Parse the budget into integer MINOR units here, once.
		 *
		 * `Math.round(major * 100)` rather than a float: money in this platform is integer minor units
		 * everywhere, and a value that arrives as 49.99 and is stored as 4998.9999999 is the classic way
		 * a currency ends up a penny short at the third handoff. An unparseable entry is refused rather
		 * than coerced to zero — "£0" is a real offer and a very different one from "I did not say".
		 */
		let budgetMinor: number | undefined;
		const raw = budget.value.trim();
		if (raw) {
			const major = Number(raw.replace(/[^0-9.]/g, ""));
			if (!Number.isFinite(major) || major < 0) {
				error.value = "That budget could not be read. Use a plain number.";
				return false;
			}
			budgetMinor = Math.round(major * 100);
		}
		error.value = null;

		const res = await BookingService.contact({
			kind: "custom_quote",
			handle: offer.value.contact.handle,
			subjectId: offer.value.subjectId,
			scope: text,
			budgetMinor,
			currency: budgetMinor === undefined ? undefined : currency,
			timeline: timeline.value.trim() || undefined,
		}, bookingSim());
		if (!res.ok || !res.data) {
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
					<p class="sbk__summarynote">
						They reply with a scope and a price. Nothing is committed.
					</p>
					<CtaButton
						label="Send request"
						settledLabel="Sent"
						phase={cta.phase}
						disabled={!scope.value.trim()}
						icon={<Icon name="send" size="sm" aria-hidden />}
						fluid={false}
						onClick={() => void cta.run(submit)}
					/>
				</div>
			}
		>
			<div class="sbk__body">
				<p class="sbk__about">
					About <span class="sbk__aboutitem">{offer.value.subjectTitle}</span>
				</p>

				<label class="sbk__note">
					<span class="sbk__notelabel">
						What do you need? <span class="sbk__req" aria-hidden="true">*</span>
					</span>
					<textarea
						class="sbk__notefield"
						rows={5}
						required
						value={scope.value}
						maxLength={4000}
						onInput={(e) => (scope.value = (e.target as HTMLTextAreaElement).value)}
					/>
				</label>

				<div class="sbk__row">
					<label class="sbk__field">
						<span class="sbk__notelabel">Rough budget (optional)</span>
						<span class="sbk__inputwrap">
							<span class="sbk__prefix" aria-hidden="true">{currency}</span>
							<input
								class="sbk__input"
								type="text"
								inputMode="decimal"
								placeholder="2,500"
								value={budget.value}
								aria-describedby="sbk-budget-hint"
								onInput={(e) => (budget.value = (e.target as HTMLInputElement).value)}
							/>
						</span>
						<span id="sbk-budget-hint" class="sbk__notehint">
							A guide, not an offer — they set the price.
						</span>
					</label>

					<label class="sbk__field">
						<span class="sbk__notelabel">When do you need it? (optional)</span>
						<input
							class="sbk__input"
							type="text"
							placeholder="Before our launch in March"
							value={timeline.value}
							maxLength={200}
							onInput={(e) => (timeline.value = (e.target as HTMLInputElement).value)}
						/>
					</label>
				</div>

				{error.value && <p class="sbk__error" role="alert">{error.value}</p>}
			</div>
		</Dialog>
	);
}
