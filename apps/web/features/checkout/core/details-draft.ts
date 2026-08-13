import { computed, type ReadonlySignal, type Signal, signal } from "@preact/signals";
import { destinationEmail, missingBuyerFields } from "@projective/types/finance";
import { CheckoutService } from "./CheckoutService.ts";
import type { CheckoutResponse } from "../types/results.ts";
import type {
	BillingContext,
	BillingContextKind,
	BuyerDetails,
	CheckoutContext,
	CheckoutSessionContext,
	MonthlyInvoicing,
	PostalAddress,
	SaveBuyerDetails,
} from "../types/checkout-types.ts";

/**
 * details-draft — the editable model behind `/checkout/details`: one signal per field, one live
 * projection of the record those signals describe, and the per-field verdict the controls render.
 *
 * Three properties are contractual rather than convenient:
 *
 * 1. **Both billing blocks are always carried.** The personal and business blocks live side by side
 *    in the draft exactly as they do in {@link BuyerDetailsSchema}, so the context switcher is a VIEW
 *    over one record rather than a mode that discards the half it is not showing. A buyer who fills
 *    the company form, flips to Personal to check a spelling and flips back finds their work intact.
 * 2. **Completeness is never re-tested here.** `missingBuyerFields` from the SSOT is the single
 *    authority the auto-skip redirect, this form, the payment gate and the server all ask. This
 *    module projects the draft back into a `BuyerDetails` and hands it to that function; it owns no
 *    opinion about which fields matter.
 * 3. **Nothing is painted invalid before the reader has had a turn.** {@link fieldVerdict} returns
 *    `default` until the field is touched, and `status="required"` is never used anywhere on this
 *    surface — it sets `aria-invalid`, so a merely-empty field would announce itself as wrong before
 *    anything had been typed (the discipline `EmailAssignment` established).
 *
 * No DOM, no money, no routing. Safe to import from either island.
 */

// #region Field identity
/**
 * The DOM id for a control bound to a dotted SSOT path.
 *
 * The path IS the identity — `missingBuyerFields` returns exactly these strings — so a summary can
 * move focus to the control responsible without a second lookup table that could fall out of step.
 * The dots are folded to dashes so the id is also usable as a CSS selector without escaping, and the
 * scope prefix keeps the page form and the modal's copy of it from minting duplicate ids when both
 * are mounted at once.
 */
export function detailsFieldId(path: string, scope = "cko-details"): string {
	return `${scope}-${path.replaceAll(".", "-")}`;
}
// #endregion

// #region Department allocation
/**
 * One selectable department, mirroring an entry of `org.organisations.departments`.
 *
 * Restated app-side rather than imported from the fat service because `packages/backend` is a server
 * member an island may not reach into — the two sides share the SHAPE, never a module.
 */
export interface DepartmentOption {
	id: string;
	label: string;
}

/**
 * The departments each billing identity offers, keyed by `BillingContext.id`.
 *
 * Resolved on the server and carried into the island, because which departments an entity declares
 * is the entity's fact, not the buyer's — and an empty list is a real state (an entity with no
 * departments), not an unfilled field.
 */
export type DetailsDepartments = Readonly<Record<string, readonly DepartmentOption[]>>;
// #endregion

// #region Signal bundles
/** The six controls of a postal address, bound one signal per line. */
export interface AddressSignals {
	line1: Signal<string>;
	line2: Signal<string>;
	city: Signal<string>;
	state: Signal<string>;
	postcode: Signal<string>;
	country: Signal<string>;
}

/** Where the deliverable goes and who to greet. */
export interface DeliverySignals {
	firstName: Signal<string>;
	lastName: Signal<string>;
	email: Signal<string>;
}

/** The natural-person billing identity. */
export interface PersonalSignals {
	name: Signal<string>;
	phone: Signal<string>;
	email: Signal<string>;
	address: AddressSignals;
}

/** The company billing identity, including the department the spend is attributed to. */
export interface BusinessSignals {
	companyName: Signal<string>;
	registrationNumber: Signal<string>;
	taxId: Signal<string>;
	corporateEmail: Signal<string>;
	phone: Signal<string>;
	address: AddressSignals;
	/** Empty string means "no department chosen", which the record carries as `null`. */
	departmentId: Signal<string>;
}

/** The whole editable form. */
export interface DetailsDraft {
	/** The billing identity being edited (`personal` · `business:{id}`). */
	contextId: Signal<string>;
	contextKind: Signal<BillingContextKind>;
	delivery: DeliverySignals;
	personal: PersonalSignals;
	business: BusinessSignals;
	/**
	 * Whether purchases are collected onto one monthly statement.
	 *
	 * Held as a BOOLEAN rather than as the SSOT's two-member enum because that is what the switch
	 * binds to, and the field primitives seed their internal signal from a raw value exactly once — a
	 * derived boolean recomputed per render would leave the control reading a signal nothing writes
	 * to. The enum is reconstituted in {@link DetailsDraft.record}, which is the only shape that
	 * leaves this module.
	 */
	invoicingMonthly: Signal<boolean>;
	/**
	 * The statement day, 1–28, held as the STRING its `Select` binds to and parsed back in
	 * {@link DetailsDraft.record}. Same reason as {@link DetailsDraft.invoicingMonthly}: a control
	 * handed a raw value seeds its internal signal once and then ignores the prop.
	 */
	billingDay: Signal<string>;
	/** Which paths the reader has finished with, keyed by dotted path. */
	touched: Signal<Readonly<Record<string, boolean>>>;
	/**
	 * The record the SERVER last returned. Dirtiness is measured against this, never against the
	 * immutable SSR prop — the defect both workspace policy screens shipped, where a successful save
	 * left the footer permanently dirty because the baseline could not move.
	 */
	baseline: Signal<BuyerDetails>;
	/** The record the draft currently describes, for the SSOT's completeness predicate. */
	record: ReadonlySignal<BuyerDetails>;
}
// #endregion

// #region Construction
/** Bind one address block. */
function addressSignals(address: PostalAddress): AddressSignals {
	return {
		line1: signal(address.line1),
		line2: signal(address.line2),
		city: signal(address.city),
		state: signal(address.state),
		postcode: signal(address.postcode),
		country: signal(address.country),
	};
}

/** Read one address block back out. */
function addressValue(signals: AddressSignals): PostalAddress {
	return {
		line1: signals.line1.value,
		line2: signals.line2.value,
		city: signals.city.value,
		state: signals.state.value,
		postcode: signals.postcode.value,
		country: signals.country.value,
	};
}

/**
 * Parse a statement day back into the 1–28 window `org.business_profiles.billing_day` enforces.
 *
 * A value outside it falls back to the server's own rather than being clamped to an edge: 29 is not
 * "the 28th", it is a value this form should never have produced, and silently reinterpreting it
 * would hide the bug that produced it.
 */
function clampBillingDay(raw: string, fallback: number): number {
	const day = Number.parseInt(raw, 10);
	return Number.isFinite(day) && day >= 1 && day <= 28 ? day : fallback;
}

/** Overwrite one address block in place, so the draft's signal identities survive a re-seed. */
function seedAddress(signals: AddressSignals, address: PostalAddress): void {
	signals.line1.value = address.line1;
	signals.line2.value = address.line2;
	signals.city.value = address.city;
	signals.state.value = address.state;
	signals.postcode.value = address.postcode;
	signals.country.value = address.country;
}

/**
 * Build a draft from a server record.
 *
 * Called once per mount and memoised by the caller: the field primitives seed their internal signal
 * from a raw value exactly once, so a draft rebuilt on every render would hand every control a fresh
 * signal it then ignores, and the form would silently stop accepting input.
 */
export function createDetailsDraft(source: BuyerDetails): DetailsDraft {
	const baseline = signal(source);
	const contextId = signal(source.contextId);
	const contextKind = signal<BillingContextKind>(source.contextKind);
	const delivery: DeliverySignals = {
		firstName: signal(source.delivery.firstName),
		lastName: signal(source.delivery.lastName),
		email: signal(source.delivery.email),
	};
	const personal: PersonalSignals = {
		name: signal(source.personal.name),
		phone: signal(source.personal.phone),
		email: signal(source.personal.email),
		address: addressSignals(source.personal.address),
	};
	const business: BusinessSignals = {
		companyName: signal(source.business.companyName),
		registrationNumber: signal(source.business.registrationNumber),
		taxId: signal(source.business.taxId),
		corporateEmail: signal(source.business.corporateEmail),
		phone: signal(source.business.phone),
		address: addressSignals(source.business.address),
		departmentId: signal(source.business.departmentId ?? ""),
	};
	const invoicingMonthly = signal<boolean>(source.invoicing.mode === "intervaled_monthly");
	const billingDay = signal<string>(String(source.invoicing.billingDay));

	const record = computed<BuyerDetails>(() => ({
		...baseline.value,
		contextId: contextId.value,
		contextKind: contextKind.value,
		delivery: {
			firstName: delivery.firstName.value,
			lastName: delivery.lastName.value,
			email: delivery.email.value,
		},
		personal: {
			name: personal.name.value,
			phone: personal.phone.value,
			email: personal.email.value,
			address: addressValue(personal.address),
		},
		business: {
			companyName: business.companyName.value,
			registrationNumber: business.registrationNumber.value,
			taxId: business.taxId.value,
			corporateEmail: business.corporateEmail.value,
			phone: business.phone.value,
			address: addressValue(business.address),
			departmentId: business.departmentId.value || null,
		},
		invoicing: {
			...baseline.value.invoicing,
			mode: invoicingMonthly.value ? "intervaled_monthly" : "per_transaction",
			billingDay: clampBillingDay(billingDay.value, baseline.value.invoicing.billingDay),
		},
	}));

	return {
		contextId,
		contextKind,
		delivery,
		personal,
		business,
		invoicingMonthly,
		billingDay,
		touched: signal<Readonly<Record<string, boolean>>>({}),
		baseline,
		record,
	};
}

/**
 * Re-seed a draft from a server record, adopting it as the new baseline and forgetting every touch.
 *
 * Signal identities are preserved rather than replaced, so every mounted control keeps the binding it
 * was given — replacing them would leave the controls reading signals nothing writes to any more.
 */
export function seedDetailsDraft(draft: DetailsDraft, source: BuyerDetails): void {
	draft.baseline.value = source;
	draft.contextId.value = source.contextId;
	draft.contextKind.value = source.contextKind;
	draft.delivery.firstName.value = source.delivery.firstName;
	draft.delivery.lastName.value = source.delivery.lastName;
	draft.delivery.email.value = source.delivery.email;
	draft.personal.name.value = source.personal.name;
	draft.personal.phone.value = source.personal.phone;
	draft.personal.email.value = source.personal.email;
	seedAddress(draft.personal.address, source.personal.address);
	draft.business.companyName.value = source.business.companyName;
	draft.business.registrationNumber.value = source.business.registrationNumber;
	draft.business.taxId.value = source.business.taxId;
	draft.business.corporateEmail.value = source.business.corporateEmail;
	draft.business.phone.value = source.business.phone;
	seedAddress(draft.business.address, source.business.address);
	draft.business.departmentId.value = source.business.departmentId ?? "";
	draft.invoicingMonthly.value = source.invoicing.mode === "intervaled_monthly";
	draft.billingDay.value = String(source.invoicing.billingDay);
	draft.touched.value = {};
}
// #endregion

// #region Touch tracking
/** Whether a path has been finished with. */
export function isTouched(draft: DetailsDraft, path: string): boolean {
	return draft.touched.value[path] === true;
}

/** Record that a path has been finished with. Idempotent. */
export function markTouched(draft: DetailsDraft, path: string): void {
	if (draft.touched.peek()[path]) return;
	draft.touched.value = { ...draft.touched.peek(), [path]: true };
}

/**
 * Touch every path the SSOT currently reports as missing.
 *
 * Used when the buyer presses Continue on an incomplete form: until that moment nothing has been
 * touched, so nothing would be painted, and the refusal would have no visible cause.
 */
export function touchMissing(draft: DetailsDraft): void {
	const next = { ...draft.touched.peek() };
	for (const field of missingBuyerFields(draft.record.peek())) next[field.path] = true;
	draft.touched.value = next;
}
// #endregion

// #region Verdicts
/** One field's rendered validation state. */
export interface FieldVerdict {
	/** `invalid` only once the field has been touched — never on first paint. */
	status: "default" | "invalid";
	/** The sentence rendered beneath the control; `null` when there is nothing wrong. */
	message: string | null;
}

/** A field with nothing to say. */
const CLEAN: FieldVerdict = { status: "default", message: null };

/**
 * The verdict for one control.
 *
 * Email validity comes from the SSOT's own {@link destinationEmail} schema — the same rule the write
 * endpoint parses against — so the field can neither accept something the server will refuse nor
 * refuse something it would have taken.
 */
export function fieldVerdict(opts: {
	value: string;
	label: string;
	touched: boolean;
	required?: boolean;
	email?: boolean;
}): FieldVerdict {
	if (!opts.touched) return CLEAN;
	const value = opts.value.trim();
	if (opts.required && value === "") {
		return { status: "invalid", message: `${opts.label} is required.` };
	}
	if (opts.email && value !== "" && !destinationEmail.safeParse(value).success) {
		return { status: "invalid", message: "Enter a valid email address." };
	}
	return CLEAN;
}
// #endregion

// #region Projection & dirtiness
/** The `PUT /api/checkout/details` payload for the current draft. */
export function draftToSave(draft: DetailsDraft): SaveBuyerDetails {
	const record = draft.record.value;
	return {
		contextId: record.contextId,
		contextKind: record.contextKind,
		delivery: record.delivery,
		personal: record.personal,
		business: record.business,
		invoicingMode: record.invoicing.mode,
		billingDay: record.invoicing.billingDay,
	};
}

/**
 * A stable comparison key for the editable half of a record.
 *
 * `savedAt` and `billingCurrency` are deliberately excluded: they are the server's to set, and
 * including them would make a saved record read as dirty the moment the server stamped it.
 */
export function detailsFingerprint(record: BuyerDetails): string {
	return JSON.stringify([
		record.contextId,
		record.contextKind,
		record.delivery,
		record.personal,
		record.business,
		record.invoicing.mode,
		record.invoicing.billingDay,
	]);
}

/** Whether the draft holds edits the server has not accepted yet. */
export function draftIsDirty(draft: DetailsDraft): boolean {
	return detailsFingerprint(draft.record.value) !== detailsFingerprint(draft.baseline.value);
}
// #endregion

// #region Write seam
/**
 * What `PUT /api/checkout/details` answers with.
 *
 * The SESSION comes back alongside the record because a save that completes the details also clears
 * the `missing_details` blocker — returning only the record would leave the payment gate reading a
 * session resolved before the thing that unblocked it.
 */
export interface SaveDetailsResult {
	buyer: BuyerDetails;
	billingContexts: BillingContext[];
	invoicing: MonthlyInvoicing;
	session: CheckoutSessionContext;
}

/** What `GET /api/checkout/details` answers with. */
export interface DetailsResult {
	buyer: BuyerDetails;
	billingContexts: BillingContext[];
	invoicing: MonthlyInvoicing;
}

/**
 * The two `CheckoutService` methods this step reads and writes through.
 *
 * ⚠ **Interim seam.** `details()` and `saveDetails()` are the backend package's to add to
 * `CheckoutService` (contract §D.5); this alias declares the agreed interface so the step compiles
 * and runs against it in the meantime. When they land, delete the alias — not the call sites, which
 * are already written against the final shape.
 */
export const detailsService = CheckoutService as unknown as {
	details(ctx: CheckoutContext): Promise<CheckoutResponse<DetailsResult>>;
	saveDetails(
		input: SaveBuyerDetails,
		ctx: CheckoutContext,
	): Promise<CheckoutResponse<SaveDetailsResult>>;
};
// #endregion
