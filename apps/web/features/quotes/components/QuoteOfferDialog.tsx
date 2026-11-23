import type { JSX } from "preact";
import { type Signal, useSignal, useSignalEffect } from "@preact/signals";
import { Dialog } from "@projective/ui/feedback";
import { Button, FormControl, NumberInput, Select, Textarea } from "@projective/ui/fields";
import { MoneyView } from "@projective/ui/display/money";
import { toMajorUnits, toMinorUnits } from "@projective/types/finance";
import { MONEY_FIELD, moneyDigits } from "@web/utils/money-field.ts";
import {
	QUOTE_LIMITS,
	type QuotableListing,
	type QuoteView,
	type SendQuoteOfferInput,
} from "@projective/types/services";

/** A seller's own quote (Decision #522): who it is for, and the services it may be priced on. */
export interface QuoteIssueTarget {
	buyerName: string;
	/** `null` while they load. */
	listings: readonly QuotableListing[] | null;
}

/** Props for {@link QuoteOfferDialog}. */
export interface QuoteOfferDialogProps {
	visible: Signal<boolean>;
	/** The request being priced; absent for a seller's own quote ({@link issue}). */
	quote?: QuoteView;
	/** A seller's own quote from a conversation: the composer adds a service picker. */
	issue?: QuoteIssueTarget;
	busy: boolean;
	/** Field-keyed refusals from the last send. */
	errors: Record<string, string>;
	/** `listing` is the chosen service's slug for a seller's own quote, else `null`. */
	onSend: (offer: SendQuoteOfferInput, listing: string | null) => void;
}

const DELIVERABLES_PLACEHOLDER = "Wireframes for 5 screens\nClickable prototype\nHandover call";

function deliverablesOf(text: string): string[] {
	return text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l !== "");
}

/**
 * QuoteOfferDialog — the host prices a quote request, or revises the offer they sent: the scope, the
 * deliverables as a checklist, one price in the listing's currency, a turnaround and how long the
 * buyer has to accept. A revision replaces the open offer; the buyer only ever holds one. With
 * `issue` it is the seller's own quote from a conversation (Decision #522), priced on the service
 * they pick. Once sent, the terms are frozen and hashed; a change is a new offer.
 */
export function QuoteOfferDialog(props: QuoteOfferDialogProps): JSX.Element {
	const { quote, issue } = props;
	const current = quote?.offer?.state === "pending" ? quote.offer : null;
	const listing = useSignal<string>("");
	const scope = useSignal("");
	const deliverables = useSignal("");
	const price = useSignal<number | null>(null);
	const priceField = useSignal<number | null>(null);
	const turnaround = useSignal<number | null>(14);
	const openFor = useSignal<number | null>(QUOTE_LIMITS.expiresInDays.default);
	const local = useSignal<Record<string, string>>({});

	useSignalEffect(() => {
		if (!props.visible.value) return;
		scope.value = current?.scope ?? "";
		deliverables.value = current?.deliverables.join("\n") ?? "";
		price.value = current?.priceMinor ?? null;
		priceField.value = toMajorUnits(current?.priceMinor ?? null, quote?.listing.currency ?? "USD");
		turnaround.value = current?.turnaroundDays ?? 14;
		openFor.value = QUOTE_LIMITS.expiresInDays.default;
		local.value = {};
		if (issue && !listing.peek()) listing.value = issue.listings?.[0]?.slug ?? "";
	});

	const picked = issue?.listings?.find((l) => l.slug === listing.value) ?? null;
	const currency = quote?.listing.currency ?? picked?.currency ?? "USD";
	const title = quote?.listing.title ?? picked?.title ?? "your service";

	function submit(): void {
		const items = deliverablesOf(deliverables.value);
		const found: Record<string, string> = {};
		if (issue && !picked) found.listing = "Pick the service this quote is for.";
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
		}, issue ? picked!.slug : null);
	}

	const error = (field: string) => local.value[field] ?? props.errors[field];
	const status = (field: string) => (error(field) ? "invalid" : "default") as "invalid" | "default";
	const verb = issue ? "Send quote" : current ? "Revise offer" : "Send offer";

	return (
		<Dialog
			visible={props.visible}
			header={issue ? `Send ${issue.buyerName} a quote` : `${verb} · ${title}`}
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
										currency={currency}
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
				{issue && (
					<FormControl
						label="Service"
						required
						hint="One of your published services. The quote is priced in its currency and runs as its engagement. Group sessions take no quotes."
						error={error("listing")}
						status={status("listing")}
					>
						{({ id, describedBy }) => (
							<Select
								id={id}
								aria-describedby={describedBy}
								value={listing}
								options={(issue.listings ?? []).map((l) => ({ label: l.title, value: l.slug }))}
								loading={issue.listings === null}
								placeholder={issue.listings?.length === 0 ? "No published services to quote" : "Choose a service"}
								status={status("listing")}
								onValueChange={(v) => (listing.value = v ?? "")}
								fluid
							/>
						)}
					</FormControl>
				)}

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
							placeholder="What you'll deliver, what's out of scope, and how many rounds of feedback are included."
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
							placeholder={DELIVERABLES_PLACEHOLDER}
							fluid
						/>
					)}
				</FormControl>

				<div class="qte-offer__row">
					<FormControl
						label="Price"
						required
						hint={`In ${currency}, the listing's currency. The buyer pays it into escrow at checkout.`}
						error={error("priceMinor")}
						status={status("priceMinor")}
					>
						{({ id, describedBy }) => (
							<NumberInput
								{...MONEY_FIELD}
								{...moneyDigits(currency)}
								id={id}
								aria-describedby={describedBy}
								value={priceField}
								min={moneyDigits(currency).precisionStep}
								onValueChange={(whole) => {
									price.value = toMinorUnits(whole, currency);
								}}
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
							<NumberInput
								id={id}
								aria-describedby={describedBy}
								value={turnaround}
								min={QUOTE_LIMITS.turnaroundDays.min}
								max={QUOTE_LIMITS.turnaroundDays.max}
								maxFractionDigits={0}
								icon="clock"
								enableIconScrub
								suffix="days"
								fluid
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
							<NumberInput
								id={id}
								aria-describedby={describedBy}
								value={openFor}
								min={QUOTE_LIMITS.expiresInDays.min}
								max={QUOTE_LIMITS.expiresInDays.max}
								maxFractionDigits={0}
								icon="hourglass"
								enableIconScrub
								suffix="days"
								fluid
							/>
						)}
					</FormControl>
				</div>
			</div>
		</Dialog>
	);
}
