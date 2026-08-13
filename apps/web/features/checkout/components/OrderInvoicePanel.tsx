import type { JSX } from "preact";
import { Icon } from "@projective/ui/icons";
import { Button } from "@projective/ui/fields";
import { Amount } from "./Amount.tsx";
import type { OrderInvoice, PostalAddress } from "../types/checkout-types.ts";

/**
 * OrderInvoicePanel — the document the order produced: who it is made out to, what was taxed, at
 * which conversion, and where the PDF lives.
 *
 * **Everything on this panel is reprinted, never derived.** The rate, its snapshot stamp, the tax
 * label, the taxable base and the tax itself all arrive pre-computed and pre-formatted, because an
 * invoice is a legal record of a charge that has already happened. A figure this component
 * calculated would be a second answer to a question the ledger already answered, and the two would
 * disagree the first time a rounding rule changed.
 *
 * **The FX statement is exactly three facts.** Origin currency, charged currency, and the rate with
 * the instant it was taken. There is deliberately no fourth: the spread and any conversion fee are an
 * open platform decision, and inventing a number for a document that may be filed with a tax
 * authority is not a design choice this surface gets to make.
 *
 * **The reverse-charge statement is not decoration.** Under an EU/UK B2B reverse charge the seller
 * charges no VAT and the document MUST say so; the wording is the tax engine's, carried whole in
 * `reverseChargeNote`. It is set at body weight rather than demoted to a caption, because a legal
 * requirement printed as a footnote is a legal requirement nobody read.
 *
 * **Separation is rung 2** (§B.4): one tonal step against the page, no border and no nested plates.
 * The wallet's box-in-box flattening is the precedent — a document is read, not operated.
 */

// #region Props
/** Props for {@link OrderInvoicePanel}. */
export interface OrderInvoicePanelProps {
	/** The invoice projection for the completed order. */
	invoice: OrderInvoice;
	/** The order's own currency, used to state the charge when no conversion applied. */
	currency: string;
	/** DOM id for the heading, so the section can be labelled by it. */
	headingId?: string;
}
// #endregion

/** Render one address as the block a document prints, skipping every line the record does not hold. */
function AddressBlock({ address }: { address: PostalAddress }): JSX.Element | null {
	const lines = [
		address.line1,
		address.line2,
		address.city,
		address.state,
		address.postcode,
		address.country,
	].filter((line) => line.trim().length > 0);

	if (lines.length === 0) return null;

	return (
		<address class="cko-order__addr">
			{lines.map((line, index) => (
				<span key={`${line}-${index}`}>
					{line}
					{index < lines.length - 1 ? <br /> : null}
				</span>
			))}
		</address>
	);
}

/** Render the order's invoice panel. */
export function OrderInvoicePanel(props: OrderInvoicePanelProps): JSX.Element {
	const { invoice, currency, headingId = "cko-order-invoice-head" } = props;
	const { fx, tax } = invoice;

	return (
		<section class="cko-order__invoice" aria-labelledby={headingId}>
			<div class="cko-order__invhead">
				<h3 class="cko-order__head" id={headingId}>Invoice</h3>
				<span class="cko-order__invnum">{invoice.number}</span>
			</div>

			{invoice.pdfHref
				? (
					<a
						class="cko-order__act"
						href={invoice.pdfHref}
						download=""
						aria-label={`Download official invoice ${invoice.number} as a PDF`}
					>
						<Icon name="download" />
						<span>Download official invoice (PDF)</span>
					</a>
				)
				: (
					<div class="cko-order__fulfil">
						<Button
							variant="outlined"
							size="sm"
							rounded
							disabled
							label="Download official invoice (PDF)"
							icon={<Icon name="download" />}
							aria-describedby="cko-order-pdf-why"
						/>
						<p class="cko-order__actmeta" id="cko-order-pdf-why">
							<span>
								The PDF is still being generated. It appears here once it is ready — your order and
								your payment are unaffected.
							</span>
						</p>
					</div>
				)}

			{
				/*
				 * Currency and conversion. When no conversion applied the panel says so outright rather
				 * than leaving a silence a reader has to interpret.
				 */
			}
			<dl class="cko-order__grid">
				<div class="cko-order__fact">
					<dt class="cko-order__factlabel">Currency</dt>
					<dd class="cko-order__factvalue">
						{fx
							? `Priced in ${fx.originCurrency}, charged in ${fx.chargedCurrency}`
							: `Priced and charged in ${currency}`}
					</dd>
				</div>

				{fx
					? (
						<div class="cko-order__fact">
							<dt class="cko-order__factlabel">Exchange rate applied</dt>
							<dd class="cko-order__factvalue">
								{fx.rateLabel}
								<span class="cko-order__slotzone">{`Taken at ${fx.asOfLabel}`}</span>
							</dd>
						</div>
					)
					: null}

				<div class="cko-order__fact">
					<dt class="cko-order__factlabel">Paid with</dt>
					<dd class="cko-order__factvalue">{invoice.paymentSummary}</dd>
				</div>

				<div class="cko-order__fact">
					<dt class="cko-order__factlabel">Billed to</dt>
					<dd class="cko-order__factvalue">
						{invoice.billedToName}
						{invoice.billedToRegistration
							? <span class="cko-order__slotzone">{invoice.billedToRegistration}</span>
							: null}
						{
							/* Nested under its own label rather than floating after the grid: an address
						    with no heading beside it is an address nobody can tell whose it is. */
						}
						<AddressBlock address={invoice.billedToAddress} />
					</dd>
				</div>

				<div class="cko-order__fact">
					<dt class="cko-order__factlabel">Issued by</dt>
					<dd class="cko-order__factvalue">
						{invoice.issuedByName}
						{invoice.issuedByRegistration
							? <span class="cko-order__slotzone">{invoice.issuedByRegistration}</span>
							: null}
					</dd>
				</div>

				{tax.buyerTaxId
					? (
						<div class="cko-order__fact">
							<dt class="cko-order__factlabel">Your tax registration</dt>
							<dd class="cko-order__factvalue">{tax.buyerTaxId}</dd>
						</div>
					)
					: null}
			</dl>

			{/* The tax treatment, then the documented total. Three rows, none of them added up here. */}
			<dl class="cko-order__rows">
				<div class="cko-order__row">
					<dt class="cko-order__rowlabel">{tax.label}</dt>
					<dd class="cko-order__rowvalue">
						<Amount value={tax.tax} />
					</dd>
				</div>

				<div class="cko-order__row">
					<dt class="cko-order__rowlabel">Taxable amount</dt>
					<dd class="cko-order__rowvalue">
						<Amount value={tax.taxable} tone="muted" />
					</dd>
				</div>

				<div class="cko-order__row" data-total="true">
					<dt class="cko-order__rowlabel">Invoice total</dt>
					<dd class="cko-order__rowvalue">
						<Amount value={invoice.totals.total} size="lead" />
					</dd>
				</div>
			</dl>

			{tax.reverseCharge && tax.reverseChargeNote
				? <p class="cko-order__legal">{tax.reverseChargeNote}</p>
				: null}
		</section>
	);
}
