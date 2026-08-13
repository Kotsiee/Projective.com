import { z } from "zod";
import { currency, minorUnitsNonNeg, timestamp } from "./common.ts";
import { FxSnapshotSchema } from "./ledger.ts";
import { PurchasableItemKind, PurchaseOwnerType, reference } from "./basket.ts";
import { MoneyViewSchema } from "./wallet.ts";
import { CheckoutTotalsSchema } from "./checkout.ts";
import { BillingContextKind, PostalAddressSchema } from "./buyer.ts";

/**
 * finance order — the Zod SSOT for what a completed checkout produced: the order record, what each
 * purchased line entitles the buyer to *right now*, and the invoice that documents the charge.
 *
 * **This is the projection `CheckoutResult.orderId` has always pointed at and nothing has ever been
 * able to resolve.** That field has shipped permanently `null` because no order shape and no orders
 * table existed (CLAUDE.md Decision #68, flagged item (g)). This file supplies the shape; the table
 * remains deferred, so the confirmation surface is a **read projection over fixtures** exactly like
 * `detail` / `messages` / `files` / the rest of this vertical. Field names are chosen so a live
 * `finance.orders` + `finance.order_lines` pair can adopt them verbatim.
 *
 * **Fulfilment is flat and nullable, not a discriminated union.** This is the same widening the asset
 * domain had to make (Decision #67): a download has no slot, a session has no file size, and a
 * pending ticket has neither — but they all render in one list, through one row component. A union
 * would force a `switch` at every read site and the first added kind would be handled by some of
 * them. One row shape with nullable facts is checked once, at the boundary, by
 * {@link fulfilmentKindOf}.
 *
 * **No cross-domain import.** `finance` is a leaf in this package (nothing here reaches into
 * `scheduling`, `org` or `explore`, and nothing outside reaches back except `org/preferences.ts`
 * taking the FX defaults). A session line therefore carries the conferencing provider as a bounded
 * **slug plus a server-resolved label** rather than importing `ConferencingProvider` — which is also
 * more honest: an order line is a *snapshot of what was booked*, not a live reference to a provider
 * whose catalogue may have moved on.
 *
 * Only enum/array/object/number/string/boolean primitives are used so the schemas stay stable across
 * Zod majors (matching `common.ts` and the sibling domains).
 */

// #region Order status
/**
 * Where an order stands.
 *
 * Distinct from `CheckoutResultStatus`, which describes one *payment attempt*: an attempt can fail
 * and be retried against the same order, and an order can be fully paid while its deliverables are
 * still in escrow. Conflating them is how "paid" comes to mean "delivered".
 */
export const OrderStatus = z.enum([
	/** Money taken, everything fulfilled or in progress. */
	"confirmed",
	/** Money taken, at least one line still awaiting a provider-side step. */
	"processing",
	/** Awaiting a provider action (3-D Secure, a PayPal approval) — the order exists, the charge does not yet. */
	"awaiting_payment",
	/** Raised against a monthly statement rather than charged now. */
	"invoiced",
	/** Reversed in full. */
	"refunded",
	/** The attempt never completed and the order was abandoned. */
	"cancelled",
]);
export type OrderStatus = z.infer<typeof OrderStatus>;
// #endregion

// #region Fulfilment
/**
 * What a purchased line entitles the buyer to on the confirmation page.
 *
 * `pending` is a first-class member, not an absence: a stage ticket bought into an unfunded stage
 * has nothing to open yet, and rendering that as a missing button would read as a broken page rather
 * than as the honest "this starts when the stage opens".
 */
export const FulfilmentKind = z.enum(["download", "engagement", "session", "pending"]);
export type FulfilmentKind = z.infer<typeof FulfilmentKind>;

/**
 * A downloadable calendar entry for a booked session, in the three formats a buyer actually has.
 *
 * `google` and `outlook` are web deep links the buyer follows; `ics` is a path on this origin that
 * serves `text/calendar`, which is what Apple Calendar and every desktop client consume. All three
 * are built by {@link calendarLinksFor} from the same fields, so a buyer who adds the session twice
 * from two different buttons gets one event, not two that disagree about the time.
 */
export const CalendarLinksSchema = z.object({
	google: z.string().max(1200),
	outlook: z.string().max(1200),
	/** Same-origin path serving the `.ics` file — never a third-party URL. */
	ics: z.string().max(600),
});
export type CalendarLinks = z.infer<typeof CalendarLinksSchema>;

/**
 * One purchased line and everything the buyer can do with it.
 *
 * The `download*` / `engagement*` / `session*` groups are mutually exclusive **in practice** but
 * independently nullable **in the schema** — see the file note on why this is not a union.
 */
export const OrderLineSchema = z.object({
	id: reference,
	/** The basket line this was purchased from, so an order can be traced back to the basket. */
	basketItemId: reference.nullable(),
	itemType: PurchasableItemKind,
	itemId: reference,
	title: z.string().min(1).max(200),
	subtitle: z.string().max(200).nullable(),
	thumbnail: z.string().max(600).nullable(),
	sellerHandle: z.string().max(40).nullable(),
	sellerName: z.string().max(120).nullable(),
	quantity: z.number().int().min(1).max(999),
	/** What this line was charged, server-computed. */
	lineTotal: MoneyViewSchema,
	/** The resolved fulfilment route. Drives which action the confirmation row renders. */
	fulfilment: FulfilmentKind,
	/** A display-ready sentence for a `pending` line ("Starts when Stage 2 is funded"). */
	pendingNote: z.string().max(200).nullable(),

	// #region Download fulfilment
	/** The asset to hand over; `null` unless {@link fulfilment} is `download`. */
	assetId: reference.nullable(),
	/** Same-origin download path. Never a third-party URL — the CSP forbids one. */
	downloadHref: z.string().max(600).nullable(),
	/** File name as delivered, including extension. */
	downloadName: z.string().max(200).nullable(),
	/** Exact size in bytes, so the label and the byte count can never disagree. */
	downloadBytes: z.number().int().min(0).nullable(),
	/** Pre-formatted size ("248 MB") — formatted server-side like every other label here. */
	downloadSizeLabel: z.string().max(24).nullable(),
	/** Delivery format ("Blender + 4K textures"), mirroring `BasketItem.format`. */
	downloadFormat: z.string().max(80).nullable(),
	/** Licence tier granted, mirroring `BasketItem.licence`. */
	licence: z.string().max(80).nullable(),
	// #endregion

	// #region Engagement fulfilment (a stage ticket / a project or service purchase)
	/**
	 * Where the work now lives — the canonical channel namespace
	 * `/projects/[projectId]/[channelId]` (CLAUDE.md Decision #22). Deliberately NOT the brief's
	 * `/projects/[id]/[stageId]`, whose second segment is a channel id in this codebase and would
	 * 404; the resolving service maps stage → channel.
	 */
	engagementHref: z.string().max(200).nullable(),
	/** Display label for that destination ("Stage 2 · Design system"). */
	engagementLabel: z.string().max(120).nullable(),
	// #endregion

	// #region Session fulfilment
	/** ISO instant of the booked slot. */
	scheduledAt: timestamp.nullable(),
	/** Pre-formatted slot ("Tue 12 Aug · 14:00–15:00 BST"), so SSR and a refetch agree. */
	scheduledLabel: z.string().max(80).nullable(),
	/** IANA timezone the slot is expressed in. */
	timezone: z.string().max(64).nullable(),
	durationMinutes: z.number().int().min(1).max(1440).nullable(),
	/** Conferencing provider slug (`zoom`, `google`, `microsoft_teams`) — a snapshot, see the file note. */
	conferencingProvider: z.string().max(40).nullable(),
	/** Server-resolved provider label ("Zoom", "Google Meet"), so the client holds no second map. */
	conferencingLabel: z.string().max(60).nullable(),
	/** The room to join; `null` until the provider mints one. */
	joinUrl: z.string().max(600).nullable(),
	/** Pre-built calendar exports; `null` for a line with no slot. */
	calendar: CalendarLinksSchema.nullable(),
	/** Seats held on a group-session line. */
	seats: z.number().int().min(1).max(500).nullable(),
	// #endregion
});
export type OrderLine = z.infer<typeof OrderLineSchema>;

/**
 * The fulfilment route a line's facts actually support, independent of what its {@link
 * OrderLineSchema.fulfilment} field claims.
 *
 * Pure and total, and the one place the nullable groups are read as a discriminator. A line that
 * claims `download` but carries no `downloadHref` resolves to `pending` — the buyer gets an honest
 * "not ready yet" instead of a button that 404s.
 */
export function fulfilmentKindOf(line: OrderLine): FulfilmentKind {
	if (line.fulfilment === "download" && line.downloadHref) return "download";
	if (line.fulfilment === "engagement" && line.engagementHref) return "engagement";
	if (line.fulfilment === "session" && line.scheduledAt) return "session";
	return "pending";
}
// #endregion

// #region Invoice
/**
 * The conversion an invoice documents.
 *
 * **Composes the ledger's {@link FxSnapshotSchema} rather than restating it.** That schema is the
 * three columns committed onto a `finance.transactions` / `finance.escrows` row (`fx_rate`,
 * `fx_base`, `fx_as_of`) and is the authority on the conversion itself; this shape adds only the two
 * facts a *document* needs and a row does not — which currency the goods were priced in and which
 * one was actually charged. Redeclaring the rate here would create a second record of the same
 * conversion, and an invoice that disagreed with its own transaction is the one thing this whole
 * money contract exists to prevent.
 *
 * Present only when the two currencies differ; a same-currency charge carries `null`.
 *
 * There is deliberately **no spread and no conversion-fee field**. The economics of both are an open
 * platform decision (`finance-model.md` §11), and a schema slot for a number nobody has decided is
 * how a fabricated figure ends up on a legal document.
 */
export const InvoiceFxSchema = FxSnapshotSchema.extend({
	/** The currency the goods were priced in. */
	originCurrency: currency,
	/** The currency actually charged. */
	chargedCurrency: currency,
	/** Pre-formatted rate statement ("1 GBP = 1.1642 EUR"), so the client composes no arithmetic. */
	rateLabel: z.string().max(80),
	/** Pre-formatted `fx_as_of` stamp in the buyer's zone ("10 Aug 2026, 18:00 UTC"). */
	asOfLabel: z.string().max(80),
});
export type InvoiceFx = z.infer<typeof InvoiceFxSchema>;

/**
 * How tax was treated on this order.
 *
 * `reverseCharge` is not cosmetic: under an EU/UK B2B reverse charge the seller charges no VAT and
 * the invoice **must** say so, and the statement is a legal requirement rather than a nicety. The
 * rate and the note are supplied by the tax engine, never derived here — this package has no
 * jurisdiction and no rate table, which is the same reason `checkoutTotals` takes `taxMinor` as an
 * input rather than computing it.
 */
export const TaxBreakdownSchema = z.object({
	/** Display label for the treatment ("VAT 20% · United Kingdom", "Reverse charge"). */
	label: z.string().max(160),
	/** The rate applied, in basis points; `0` under a reverse charge or an exemption. */
	rateBp: z.number().int().min(0).max(10000),
	taxable: MoneyViewSchema,
	tax: MoneyViewSchema,
	/** Whether the buyer accounts for the VAT themselves. */
	reverseCharge: z.boolean(),
	/** The statement that must appear on the document when {@link reverseCharge}; else `null`. */
	reverseChargeNote: z.string().max(240).nullable(),
	/** The buyer's tax registration as recorded at the time of the charge. */
	buyerTaxId: z.string().max(60).nullable(),
});
export type TaxBreakdown = z.infer<typeof TaxBreakdownSchema>;

/**
 * The invoice document's projection — everything the PDF prints, resolved server-side.
 *
 * Mirrors `finance.invoices` (`invoice_type`, `subtotal_cents`, `platform_fee_cents`, `tax_cents`,
 * `total_cents`, `currency`, `status`, `issue_date`, `due_date`, `pdf_file_id`) plus the FX snapshot
 * and the tax treatment the existing columns cannot express.
 */
export const OrderInvoiceSchema = z.object({
	/** Human invoice reference ("INV-2026-0814"). */
	number: z.string().min(1).max(40),
	issuedAt: timestamp,
	/** Where the PDF is served from — same origin. `null` while it is still being rendered. */
	pdfHref: z.string().max(600).nullable(),
	/** Who the invoice is made out to. */
	billedToName: z.string().max(160),
	billedToKind: BillingContextKind,
	billedToAddress: PostalAddressSchema,
	/** The company registration recorded on the document; `null` for a personal invoice. */
	billedToRegistration: z.string().max(60).nullable(),
	/** The seller of record — the platform entity raising the document. */
	issuedByName: z.string().max(160),
	issuedByRegistration: z.string().max(60).nullable(),
	totals: CheckoutTotalsSchema,
	tax: TaxBreakdownSchema,
	/** The conversion applied, when one was; `null` for a same-currency charge. */
	fx: InvoiceFxSchema.nullable(),
	/** How it was paid ("Visa •••• 4242", "Projective wallet"). */
	paymentSummary: z.string().max(120),
});
export type OrderInvoice = z.infer<typeof OrderInvoiceSchema>;
// #endregion

// #region Order
/** A completed checkout, and everything the confirmation hub renders from it. */
export const OrderSchema = z.object({
	id: reference,
	/** The buyer-facing reference ("PJ-8QK4-2M7X") — short, unambiguous, and safe to read aloud. */
	reference: z.string().min(1).max(40),
	status: OrderStatus,
	placedAt: timestamp,
	/** Pre-formatted placement stamp ("10 Aug 2026, 19:22 BST") in the buyer's zone. */
	placedAtLabel: z.string().max(80),
	ownerType: PurchaseOwnerType,
	ownerId: reference,
	ownerName: z.string().max(120),
	/** The basket this order was raised from, so "buy these again" can resolve. */
	basketId: reference.nullable(),
	currency,
	lines: z.array(OrderLineSchema).max(200),
	totals: CheckoutTotalsSchema,
	invoice: OrderInvoiceSchema.nullable(),
	/** The provider used, as a display string ("Projective wallet", "Monthly invoice"). */
	paymentMethodLabel: z.string().max(120),
	/** What was actually charged now — zero on an invoiced order, which is the point of one. */
	charged: MoneyViewSchema,
	/**
	 * The buyer's optional contribution toward gateway costs, if they opted in. A zero-valued
	 * `MoneyView` rather than `null` so the arithmetic has no branch and the line can always render.
	 */
	processingContribution: MoneyViewSchema,
	/** How many lines are still awaiting fulfilment — drives the hub's status banner. */
	pendingCount: z.number().int().min(0),
	/** A display-ready outcome sentence from the payment attempt. */
	message: z.string().max(200),
});
export type Order = z.infer<typeof OrderSchema>;

/** The confirmation page's whole read. */
export const OrderPageSchema = z.object({
	order: OrderSchema,
	/** The buyer's other recent orders, so the hub can offer "your orders" without a second read. */
	recent: z.array(z.object({
		id: reference,
		reference: z.string().max(40),
		placedAtLabel: z.string().max(80),
		total: MoneyViewSchema,
		status: OrderStatus,
	})).max(20),
});
export type OrderPage = z.infer<typeof OrderPageSchema>;
// #endregion

// #region Calendar export (pure builders — one implementation, three formats)
/** The facts a calendar entry needs. Deliberately structural, so a caller can build one from anything. */
export interface CalendarEventInput {
	title: string;
	/** ISO instant the session starts. */
	startIso: string;
	durationMinutes: number;
	/** Plain-text description; the join URL is appended by the builders when present. */
	description?: string;
	/** The room to join, or a physical location. */
	location?: string;
	/** A stable id so re-adding the event UPDATES it rather than duplicating it. */
	uid?: string;
}

/** `YYYYMMDDTHHMMSSZ` — the only timestamp format Google, Outlook and iCalendar all accept. */
function stampUtc(iso: string, addMinutes = 0): string {
	const ms = Date.parse(iso);
	if (!Number.isFinite(ms)) return "";
	return new Date(ms + addMinutes * 60_000).toISOString().replace(/[-:]/g, "").replace(
		/\.\d{3}/,
		"",
	);
}

/**
 * Build the three calendar links for one session.
 *
 * `origin` is the app's own origin, used only for the same-origin `.ics` path — no third-party host
 * appears in the returned `ics` value, because a published surface runs under a strict CSP with no
 * external origins.
 */
export function calendarLinksFor(
	event: CalendarEventInput,
	icsPath: string,
): CalendarLinks {
	const start = stampUtc(event.startIso);
	const end = stampUtc(event.startIso, event.durationMinutes);
	const details = [event.description, event.location].filter(Boolean).join("\n\n");

	const google = "https://calendar.google.com/calendar/render?" +
		new URLSearchParams({
			action: "TEMPLATE",
			text: event.title,
			dates: `${start}/${end}`,
			details,
			location: event.location ?? "",
		}).toString();

	const outlook = "https://outlook.live.com/calendar/0/deeplink/compose?" +
		new URLSearchParams({
			path: "/calendar/action/compose",
			rru: "addevent",
			subject: event.title,
			startdt: event.startIso,
			enddt: new Date(Date.parse(event.startIso) + event.durationMinutes * 60_000).toISOString(),
			body: details,
			location: event.location ?? "",
		}).toString();

	return { google, outlook, ics: icsPath };
}

/**
 * Escape one iCalendar TEXT value.
 *
 * RFC 5545 §3.3.11 requires backslash, semicolon, comma and newline to be escaped, **and the
 * backslash must be replaced first** — escaping it after the others would double-escape the
 * backslashes those replacements just introduced, and the entry would render with visible `\n`
 * sequences in the description.
 */
function icsEscape(value: string): string {
	return value
		.replace(/\\/g, "\\\\")
		.replace(/;/g, "\\;")
		.replace(/,/g, "\\,")
		.replace(/\r?\n/g, "\\n");
}

/**
 * Fold one content line to the 75-octet limit (RFC 5545 §3.1).
 *
 * Folded continuation lines begin with a single space. Clients that ignore folding still parse a
 * short line, so this only ever matters on long descriptions — which is exactly where an unfolded
 * line silently truncates in some desktop clients.
 */
function icsFold(line: string): string {
	if (line.length <= 75) return line;
	const parts: string[] = [line.slice(0, 75)];
	for (let i = 75; i < line.length; i += 74) parts.push(" " + line.slice(i, i + 74));
	return parts.join("\r\n");
}

/**
 * Render a complete `.ics` document for one session.
 *
 * Pure: no clock, no IO. `dtStampIso` is passed in rather than read from `Date.now()` so the same
 * inputs always produce the same bytes — which is what lets the route cache it and what keeps the
 * fixtures deterministic.
 *
 * Lines are joined with CRLF, which the specification requires; a client parsing LF-only content is
 * being lenient, and several are not.
 */
export function buildIcsCalendar(event: CalendarEventInput, dtStampIso: string): string {
	const lines = [
		"BEGIN:VCALENDAR",
		"VERSION:2.0",
		"PRODID:-//Projective//Checkout//EN",
		"CALSCALE:GREGORIAN",
		"METHOD:PUBLISH",
		"BEGIN:VEVENT",
		`UID:${icsEscape(event.uid ?? `${stampUtc(event.startIso)}@projective`)}`,
		`DTSTAMP:${stampUtc(dtStampIso)}`,
		`DTSTART:${stampUtc(event.startIso)}`,
		`DTEND:${stampUtc(event.startIso, event.durationMinutes)}`,
		`SUMMARY:${icsEscape(event.title)}`,
		event.description ? `DESCRIPTION:${icsEscape(event.description)}` : null,
		event.location ? `LOCATION:${icsEscape(event.location)}` : null,
		"END:VEVENT",
		"END:VCALENDAR",
	].filter((line): line is string => line !== null);

	return lines.map(icsFold).join("\r\n") + "\r\n";
}
// #endregion

// #region Read query
/** A resolved order read. */
export interface OrderQuery {
	/** The order to read; `null` resolves the account's most recent. */
	orderId?: string | null;
	owner?: string | null;
	display?: string | null;
}

/** The `POST /api/checkout/create` follow-through: which order a completed attempt produced. */
export const OrderRefSchema = z.object({
	orderId: reference,
	reference: z.string().max(40),
	/** What the buyer was charged, echoed so the confirmation can be trusted without a second read. */
	chargedMinor: minorUnitsNonNeg,
	currency,
});
export type OrderRef = z.infer<typeof OrderRefSchema>;
// #endregion
