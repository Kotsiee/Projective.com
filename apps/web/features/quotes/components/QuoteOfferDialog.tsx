import type { JSX } from "preact";
import { type Signal, useSignal, useSignalEffect } from "@preact/signals";
import { Dialog } from "@projective/ui/feedback";
import { Button, FormControl, MoneyInput, NumberStepper, Textarea } from "@projective/ui/fields";
import { MoneyView } from "@projective/ui/display/money";
import { QUOTE_LIMITS, type QuoteView, type SendQuoteOfferInput } from "@projective/types/services";

/** Props for {@link QuoteOfferDialog}. */
export interface QuoteOfferDialogProps {
	visible: Signal<boolean>;
	quote: QuoteView;
	busy: boolean;
	/** Field-keyed refusals from the last send. */
	errors: Record<string, string>;
	onSend: (offer: SendQuoteOfferInput) => void;
}

function deliverablesOf(text: string): string[] {
	return text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l !== "");
}

/**
 * QuoteOfferDialog — the host prices a quote request, or revises the offer they sent: the scope, the
 * deliverables as a checklist, one price in the listing's currency, a turnaround and how long the
 * buyer has to accept. A revision replaces the open offer; the buyer only ever holds one.
 */
export function QuoteOfferDialog(props: QuoteOfferDialogProps): JSX.Element {
	const { quote } = props;
	const current = quote.offer?.state === "pending" ? quote.offer : null;
	const scope = useSignal("");
	const deliverables = useSignal("");
	const price = useSignal<number | null>(null);
	const turnaround = useSignal<number | null>(14);
	const openFor = useSignal<number | null>(QUOTE_LIMITS.expiresInDays.default);
	const local = useSignal<Record<string, string>>({});

	useSignalEffect(() => {
		if (!props.visible.value) return;
		scope.value = current?.scope ?? "";
		deliverables.value = current?.deliverables.join("\n") ?? "";
		price.value = current?.priceMinor ?? null;
		turnaround.value = current?.turnaroundDays ?? 14;
		openFor.value = QUOTE_LIMITS.expiresInDays.default;
		local.value = {};
	});

	function submit(): void {
		const items = deliverablesOf(deliverables.value);
		const found: Record<string, string> = {};
		if (!scope.value.trim()) found.scope = "Describe the scope.";
		if (items.length > QUOTE_LIMITS.deliverablesMax) {
			found.deliverables = "List at most 12 deliverables.";
		} else if (items.some((d) => d.length > QUOTE_LIMITS.deliverableMax)) {
			found.deliverables = "Keep each deliverable to 160 characters.";
		}
		if (!price.value || price.value <= 0) found.priceMinor = "Set a price above zero.";
		if (!turnaround.value) found.turnaroundDays = "Set a turnaround.";
		local.value = found;
		if (Object.keys(found).length > 0) return;
		props.onSend({
			action: "send_offer",
			scope: scope.value.trim(),
			deliverables: items,
			priceMinor: price.value!,
			turnaroundDays: turnaround.value!,
			expiresInDays: openFor.value ?? QUOTE_LIMITS.expiresInDays.default,
		});
	}

	const error = (field: string) => local.value[field] ?? props.errors[field];
	const status = (field: string) => (error(field) ? "invalid" : "default") as "invalid" | "default";
	const verb = current ? "Revise offer" : "Send offer";

	return (
		<Dialog
			visible={props.visible}
			header={`${verb} · ${quote.listing.title}`}
			width="min(36rem, 94vw)"
			class="qte-offer"
			footer={
				<div class="qte-offer__footer">
					<p class="qte-offer__sum">
						{price.value && price.value > 0
							? (
								<>
									Paid into escrow at checkout:{" "}
									<MoneyView
										minor={price.value}
										currency={quote.listing.currency}
										size="body"
										exact
									/>
								</>
							)
							: "Nothing is charged until the buyer pays at checkout."}
					</p>
					<Button
						label="Cancel"
						severity="neutral"
						variant="outlined"
						onClick={() => (props.visible.value = false)}
					/>
					<Button
						label={verb}
						severity="accent"
						aria-busy={props.busy}
						onClick={() => {
							if (!props.busy) submit();
						}}
					/>
				</div>
			}
		>
			<div class="qte-offer__body">
				<FormControl
					label="Scope"
					required
					hint="What you will do, in your words. It becomes the engagement's brief."
					error={error("scope")}
					status={status("scope")}
				>
					{({ id, describedBy }) => (
						<Textarea
							id={id}
							aria-describedby={describedBy}
							value={scope}
							rows={5}
							maxLength={QUOTE_LIMITS.scopeMax}
							status={status("scope")}
							fluid
						/>
					)}
				</FormControl>

				<FormControl
					label="Deliverables"
					hint="One per line, up to 12. They are a checklist inside one escrow, not separately paid stages."
					error={error("deliverables")}
					status={status("deliverables")}
				>
					{({ id, describedBy }) => (
						<Textarea
							id={id}
							aria-describedby={describedBy}
							value={deliverables}
							rows={4}
							status={status("deliverables")}
							fluid
						/>
					)}
				</FormControl>

				<div class="qte-offer__row">
					<FormControl
						label="Price"
						required
						hint={`In ${quote.listing.currency}, the listing's currency. The buyer pays it into escrow at checkout.`}
						error={error("priceMinor")}
						status={status("priceMinor")}
					>
						{({ id, describedBy }) => (
							<MoneyInput
								id={id}
								aria-describedby={describedBy}
								value={price}
								currency={quote.listing.currency}
								min={1}
								status={status("priceMinor")}
								fluid
							/>
						)}
					</FormControl>

					<FormControl
						label="Turnaround"
						hint="Days from payment to delivery. It sets the engagement's due date."
						error={error("turnaroundDays")}
						status={status("turnaroundDays")}
					>
						{({ id, describedBy }) => (
							<NumberStepper
								id={id}
								aria-describedby={describedBy}
								value={turnaround}
								min={QUOTE_LIMITS.turnaroundDays.min}
								max={QUOTE_LIMITS.turnaroundDays.max}
								unit="days"
								valueText={(n) => `${n} days`}
							/>
						)}
					</FormControl>

					<FormControl
						label="Open for"
						hint="How long the buyer has to accept, 3 to 30 days. After that the offer expires."
						error={error("expiresInDays")}
						status={status("expiresInDays")}
					>
						{({ id, describedBy }) => (
							<NumberStepper
								id={id}
								aria-describedby={describedBy}
								value={openFor}
								min={QUOTE_LIMITS.expiresInDays.min}
								max={QUOTE_LIMITS.expiresInDays.max}
								unit="days"
								valueText={(n) => `${n} days`}
							/>
						)}
					</FormControl>
				</div>
			</div>
		</Dialog>
	);
}
