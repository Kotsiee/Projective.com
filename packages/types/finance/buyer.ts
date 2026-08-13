import { z } from "zod";
import { currency, timestamp } from "./common.ts";
import { destinationEmail, PurchaseOwnerType, reference } from "./basket.ts";

/**
 * finance buyer — the Zod SSOT for the details a buyer supplies once and the checkout then stops
 * asking for: who the deliverable goes to, who is billed, and (for an entity) which budget it lands
 * against.
 *
 * **Why this is its own leaf and not a widening of `checkout.ts`.** A checkout session is a
 * projection of a *basket at a moment*; buyer details outlive every basket the account will ever
 * have. Folding them into the session shape would make "have I saved my details" a property of a
 * purchase, which is exactly the confusion that leads to a details form re-appearing on the second
 * order. `checkout.ts` imports this file, never the reverse, so the graph stays acyclic.
 *
 * **Column provenance.** Where a real column already holds a fact, the field mirrors it by name and
 * nullability rather than inventing a parallel one — each is named in its doc comment. The business
 * block in particular is a projection over `org.business_profiles` (`legal_name`, `tax_id`,
 * `billing_email`, `address_line_1`, `address_city`, `address_zip`, `country`, `invoicing_mode`,
 * `billing_day`) and `org.organisations` (`registration_number`, `corporate_email`,
 * `corporate_phone`, `address_postcode`, `address_country`, `departments`).
 *
 * **What has no column yet.** There is no per-user billing address anywhere in the schema, and no
 * `finance.buyer_details` table: the personal block and the saved-details lifecycle are a **read +
 * write projection over fixtures**, matching how the rest of this vertical ships (CLAUDE.md Decision
 * #68). Field names are chosen so the live table can adopt them verbatim.
 *
 * Only enum/array/object/number/string/boolean primitives are used so the schemas stay stable across
 * Zod majors (matching `common.ts` and the sibling domains).
 */

// #region Billing context
/**
 * Which set of billing facts a buyer is supplying.
 *
 * `personal` and `business` are **forms, not owners**. A `PurchaseOwnerType` says whose money is
 * spent; this says which legal identity is invoiced, and the two are genuinely independent — a
 * member paying from their own wallet may still need a company invoice for reimbursement. Deriving
 * one from the other is how a sole trader ends up unable to enter a VAT number.
 */
export const BillingContextKind = z.enum(["personal", "business"]);
export type BillingContextKind = z.infer<typeof BillingContextKind>;

/**
 * A selectable billing identity in the Details page's context switcher: the buyer's personal
 * identity, plus one entry per entity they may bill through.
 */
export const BillingContextSchema = z.object({
	/** `personal`, or the entity reference (`business:{id}` / `organisation:{id}`). */
	id: reference,
	kind: BillingContextKind,
	/** Display name ("Personal", "Flower Shop"). */
	label: z.string().min(1).max(120),
	/** The entity `@handle`, for the canonical `/@handle` link; `null` for the personal identity. */
	handle: z.string().max(40).nullable(),
	avatar: z.string().max(600).nullable(),
	/** Whose money this identity spends when selected — the input to `availableProviders`. */
	ownerType: PurchaseOwnerType,
	ownerId: reference,
	/** Whether details are already saved against this identity. Drives the auto-skip. */
	hasSavedDetails: z.boolean(),
	/**
	 * `org.business_profiles.kyb_status = 'verified'` **and** verification Level 3. The single gate on
	 * monthly invoicing; `false` for every personal identity by construction.
	 */
	isKybVerified: z.boolean(),
});
export type BillingContext = z.infer<typeof BillingContextSchema>;
// #endregion

// #region Postal address
/**
 * A postal address.
 *
 * Field names mirror `org.organisations` (`address_line_1`, `address_city`, `address_postcode`,
 * `address_country`) rather than `org.business_profiles`, whose `address_zip` is the same fact under
 * a US-centric name; the resolving service maps the one column onto {@link postcode}. `line2` and
 * {@link state} have no column on either table and are projection-only — both are required by real
 * postal systems (a US state is not optional at a payment processor) and both are the first things a
 * live `finance.buyer_details` table should carry.
 *
 * Every field is a bounded string rather than a formatted whole: an address that arrives as one blob
 * cannot be validated, cannot be sent to a tax engine, and cannot be corrected field by field.
 */
export const PostalAddressSchema = z.object({
	/** `address_line_1` — street and number. */
	line1: z.string().trim().max(160),
	/** Apartment, suite, floor. Projection-only; no column yet. */
	line2: z.string().trim().max(160),
	/** `address_city`. */
	city: z.string().trim().max(80),
	/** State / province / region. Projection-only; no column yet. Optional in the UK, required in the US. */
	state: z.string().trim().max(80),
	/** `address_postcode` (`address_zip` on `org.business_profiles`). */
	postcode: z.string().trim().max(20),
	/** `address_country` — an ISO-3166 alpha-2 code, uppercased by the resolver. */
	country: z.string().trim().max(60),
});
export type PostalAddress = z.infer<typeof PostalAddressSchema>;

/** An empty address — the shape a first-time buyer's form is seeded with. */
export const EMPTY_ADDRESS: PostalAddress = {
	line1: "",
	line2: "",
	city: "",
	state: "",
	postcode: "",
	country: "",
};
// #endregion

// #region Delivery details
/**
 * Where a digital deliverable goes and who to greet.
 *
 * Deliberately **no physical address**: an individual buying a digital licence has nothing shipped
 * to them, and a checkout that demands a street for a file download is asking for data it will never
 * use. The per-line `BasketItem.destinationEmail` still wins for a line that overrides it — this is
 * the account-level default that pre-fills it.
 */
export const DeliveryDetailsSchema = z.object({
	firstName: z.string().trim().min(1).max(80),
	lastName: z.string().trim().min(1).max(80),
	/** The default destination for every digital deliverable in the order. */
	email: destinationEmail,
});
export type DeliveryDetails = z.infer<typeof DeliveryDetailsSchema>;
// #endregion

// #region Billing details
/**
 * The personal billing identity — a natural person's invoice.
 *
 * `phone` is optional because a card payment does not require one; every other field is what a
 * payment processor and a tax engine both need to place the buyer in a jurisdiction.
 */
export const PersonalBillingSchema = z.object({
	/** Name as it appears on the instrument being billed. */
	name: z.string().trim().max(120),
	/** E.164-ish; kept permissive so an international number is never rejected for its shape. */
	phone: z.string().trim().max(32),
	email: destinationEmail.or(z.literal("")),
	address: PostalAddressSchema,
});
export type PersonalBilling = z.infer<typeof PersonalBillingSchema>;

/**
 * The business billing identity — a company's invoice.
 *
 * The three identifiers are distinct on purpose and are not interchangeable: {@link companyName} is
 * `org.business_profiles.legal_name`, {@link registrationNumber} is the incorporation number
 * (`org.organisations.registration_number`, documented there as "CRN / EIN / VAT / Tax ID"), and
 * {@link taxId} is the tax registration (`org.business_profiles.tax_id`). A company can hold a CRN
 * and no VAT registration, so collapsing them into one field makes a legitimate state unfilable.
 */
export const BusinessBillingSchema = z.object({
	/** `org.business_profiles.legal_name`. */
	companyName: z.string().trim().max(160),
	/** `org.organisations.registration_number` — the CRN / incorporation number. */
	registrationNumber: z.string().trim().max(60),
	/** `org.business_profiles.tax_id` — the VAT / EIN registration. */
	taxId: z.string().trim().max(60),
	/** `org.organisations.corporate_email` (`billing_email` on a business profile). */
	corporateEmail: destinationEmail.or(z.literal("")),
	/** `org.organisations.corporate_phone`. */
	phone: z.string().trim().max(32),
	/** The registered address. */
	address: PostalAddressSchema,
	/**
	 * Which department the spend is attributed to — one of `org.organisations.departments`. `null`
	 * when the entity declares no departments, which is a real state and not an unfilled field.
	 */
	departmentId: reference.nullable(),
});
export type BusinessBilling = z.infer<typeof BusinessBillingSchema>;
// #endregion

// #region Monthly invoicing
/**
 * Consolidated monthly billing — `org.business_profiles.invoicing_mode` plus `billing_day`.
 *
 * This is **not** a new concept invented for the checkout: the column has shipped with a
 * `CHECK (invoicing_mode IN ('per_transaction','intervaled_monthly'))` since the consolidated org
 * tables, and `finance.invoices.invoice_type` already carries `consolidated_monthly`. The checkout
 * surfaces the setting; it does not define it.
 */
export const InvoicingMode = z.enum(["per_transaction", "intervaled_monthly"]);
export type InvoicingMode = z.infer<typeof InvoicingMode>;

/** The monthly-invoicing offer for one billing identity, and why it is or is not available. */
export const MonthlyInvoicingSchema = z.object({
	mode: InvoicingMode,
	/**
	 * `org.business_profiles.billing_day` — the day of the month the statement is raised, 1–28. The
	 * ceiling is the column's own CHECK and is deliberate: no month is shorter than 28 days, so a
	 * higher value would silently skip February.
	 */
	billingDay: z.number().int().min(1).max(28),
	/**
	 * Whether this identity may switch to monthly invoicing at all — KYB Level 3 only. Deferred
	 * settlement is credit, and credit is extended to a verified business, never to an individual
	 * (the same rule `availableProviders` applies to the `invoice` provider).
	 */
	eligible: z.boolean(),
	/** Why it is refused; `null` when {@link eligible}. Rendered beside the disabled control. */
	ineligibleReason: z.string().max(200).nullable(),
	/** Display-ready description of the next statement ("Billed 1 September"); `null` when off. */
	nextStatementLabel: z.string().max(80).nullable(),
});
export type MonthlyInvoicing = z.infer<typeof MonthlyInvoicingSchema>;
// #endregion

// #region The saved record
/**
 * One saved buyer-details record, scoped to a billing identity.
 *
 * Both billing blocks are always present rather than discriminated on {@link contextKind}. That is a
 * deliberate cost: a discriminated union would drop whichever block is inactive, so a buyer who
 * fills the business form, switches to personal, and switches back would find it emptied. Keeping
 * both means the switcher is a *view* over one record instead of a destructive mode.
 */
export const BuyerDetailsSchema = z.object({
	/** The billing identity these details belong to (`personal`, `business:{id}`). */
	contextId: reference,
	contextKind: BillingContextKind,
	delivery: DeliveryDetailsSchema.partial().extend({
		firstName: z.string().trim().max(80),
		lastName: z.string().trim().max(80),
		email: destinationEmail.or(z.literal("")),
	}),
	personal: PersonalBillingSchema,
	business: BusinessBillingSchema,
	invoicing: MonthlyInvoicingSchema,
	/** The currency this identity's invoices are raised in (`default_currency`). */
	billingCurrency: currency,
	/** When the buyer last saved these details; `null` for a record that has never been saved. */
	savedAt: timestamp.nullable(),
});
export type BuyerDetails = z.infer<typeof BuyerDetailsSchema>;

/** The `PUT /api/checkout/details` payload — the whole record, saved as one atomic edit. */
export const SaveBuyerDetailsSchema = z.object({
	contextId: reference,
	contextKind: BillingContextKind,
	delivery: z.object({
		firstName: z.string().trim().max(80),
		lastName: z.string().trim().max(80),
		email: destinationEmail.or(z.literal("")),
	}),
	personal: PersonalBillingSchema,
	business: BusinessBillingSchema,
	/** Change the invoicing mode in the same write; omitted leaves it untouched. */
	invoicingMode: InvoicingMode.optional(),
	billingDay: z.number().int().min(1).max(28).optional(),
});
export type SaveBuyerDetails = z.infer<typeof SaveBuyerDetailsSchema>;
// #endregion

// #region Completeness (the ONE predicate the auto-skip and the form both ask)
/**
 * A field the buyer still has to supply, named so the surface can both list what is missing and
 * focus the control responsible.
 */
export interface MissingBuyerField {
	/** Dotted path into {@link BuyerDetailsSchema} (`business.address.city`). Also the control's id. */
	path: string;
	/** The field's visible label ("City"), for the summary sentence. */
	label: string;
	/** Which block it belongs to, so the summary can group. */
	section: "delivery" | "billing";
}

/** The delivery fields every buyer must supply, in form order. */
const DELIVERY_REQUIRED: readonly (readonly [string, string])[] = [
	["delivery.firstName", "First name"],
	["delivery.lastName", "Last name"],
	["delivery.email", "Email"],
];

/** The personal billing fields, in form order. `phone` and `state` are genuinely optional. */
const PERSONAL_REQUIRED: readonly (readonly [string, string])[] = [
	["personal.name", "Name"],
	["personal.email", "Email"],
	["personal.address.line1", "Address"],
	["personal.address.city", "City"],
	["personal.address.postcode", "Postcode"],
	["personal.address.country", "Country"],
];

/** The business billing fields, in form order. */
const BUSINESS_REQUIRED: readonly (readonly [string, string])[] = [
	["business.companyName", "Company name"],
	["business.registrationNumber", "Company registration number"],
	["business.taxId", "Tax / VAT ID"],
	["business.corporateEmail", "Corporate email"],
	["business.phone", "Mobile phone"],
	["business.address.line1", "Registered address"],
	["business.address.city", "City"],
	["business.address.postcode", "Postcode"],
	["business.address.country", "Country"],
];

/** Read a dotted path off the record, returning `""` for anything absent or non-string. */
function at(details: BuyerDetails, path: string): string {
	let node: unknown = details;
	for (const key of path.split(".")) {
		if (typeof node !== "object" || node === null) return "";
		node = (node as Record<string, unknown>)[key];
	}
	return typeof node === "string" ? node.trim() : "";
}

/**
 * Everything still missing from a buyer-details record, in form order.
 *
 * **Pure, total, and the single authority on "are these details complete?"** — the auto-skip on
 * `/checkout/details`, the form's own validation, the "Change details" summary and the server's
 * re-check all call this one function. A second implementation is how a buyer comes to be skipped
 * past a form that the payment step then refuses them for.
 *
 * Only the ACTIVE billing block is examined. A buyer billing personally is not missing a VAT number.
 */
export function missingBuyerFields(details: BuyerDetails): MissingBuyerField[] {
	const required = details.contextKind === "business" ? BUSINESS_REQUIRED : PERSONAL_REQUIRED;
	const missing: MissingBuyerField[] = [];
	for (const [path, label] of DELIVERY_REQUIRED) {
		if (!at(details, path)) missing.push({ path, label, section: "delivery" });
	}
	for (const [path, label] of required) {
		if (!at(details, path)) missing.push({ path, label, section: "billing" });
	}
	return missing;
}

/**
 * Whether a buyer may skip the Details step.
 *
 * A record that has never been saved is never complete, even if every field happens to be
 * pre-filled from the account: pre-fill is a suggestion the buyer has not yet confirmed, and
 * skipping a form the buyer never saw is how an order is delivered to a stale address.
 */
export function buyerDetailsComplete(details: BuyerDetails): boolean {
	return details.savedAt !== null && missingBuyerFields(details).length === 0;
}
// #endregion
