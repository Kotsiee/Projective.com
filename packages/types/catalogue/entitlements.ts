import { z } from "zod";
import { ListingLicence } from "./offer.ts";

/**
 * catalogue entitlements — what a buyer holds after paying for a digital product, and the frozen
 * version it delivers (Decision #488; ASSET_DELIVERY_ARCHITECTURE.md §10, Phase 0).
 *
 * Publishing a product freezes its attached library files into a numbered
 * `catalogue.product_versions` row (ruling A6); paying for it writes one `catalogue.entitlements` row
 * per product line, in the checkout's own transaction (`finance.place_wallet_order`). The row schemas
 * here are those tables column for column (`entitlements.contract.test.ts`); the purchase DTOs are what
 * the purchases view (`/files?source=purchases`) and the order confirmation render. A DTO never carries
 * a storage address: a file is reached only through {@link downloadHref}.
 */

// #region Column primitives
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uuid = z.string().regex(UUID_RE, "Expected a UUID.");
/** A `timestamptz` as PostgREST serialises it (an ISO string). */
const timestamptz = z.string();
// #endregion

// #region Vocabulary
/**
 * Whether a bought product's files may still be fetched. Mirrors `catalogue.entitlement_status`
 * member for member: `active` from the purchase on, `refunded` once its line is refunded, `revoked`
 * when an operator withdraws access. A delivered file cannot be recalled, so the last two only close
 * future access — the download route answers both with its one 404.
 */
export const EntitlementStatus = z.enum(["active", "refunded", "revoked"]);
export type EntitlementStatus = z.infer<typeof EntitlementStatus>;

/** Who holds an entitlement. Mirrors `files.owner_kind`: a freelancer's purchase is their person's. */
export const EntitlementHolderType = z.enum(["user", "team", "business", "enterprise"]);
export type EntitlementHolderType = z.infer<typeof EntitlementHolderType>;

/** An entitlement's address, `ent-` and ten symbols of the slug alphabet (Decision #88). */
export const ENTITLEMENT_SLUG_RE = /^ent-[23456789abcdefghjkmnopqrstuvwxyz]{10}$/;
export const EntitlementSlug = z.string().regex(ENTITLEMENT_SLUG_RE, "Expected an ent- address.");
// #endregion

// #region The A8 acknowledgement
/**
 * The basket-line metadata key the checkout sets when the buyer ticks the acknowledgement before Pay
 * (ruling A8). `finance.place_wallet_order` reads it and stamps `delivery_terms_accepted_at`; nothing
 * else reads or writes it.
 */
export const DELIVERY_TERMS_KEY = "deliveryTermsAccepted";

/**
 * The words of the A8 acknowledgement, shown on `/checkout/payment` for every line that delivers a
 * file. They state the owner's rule (Decision #337 M8) with ruling A8's meaning of "downloaded", and
 * are PENDING COUNSEL: `PRODUCT_SPEC.md` §Digital Marketplace 6 holds the same text, and the refund
 * consequence stays behind the `finance.delivered_refund_refusal` flag, off, until counsel signs off.
 */
export const DELIVERY_TERMS_COPY = {
	title: "Digital files are non-refundable once downloaded",
	body:
		"You get these files straight after payment. Once a file has finished downloading in full, the order is no longer refundable, unless the file is defective or never arrives.",
	accept:
		"I want the files now, and I understand I lose the right to a refund once one has downloaded in full.",
} as const;
// #endregion

// #region Rows
/**
 * One file of a frozen version (`catalogue.product_versions.manifest[]`): the seller's library file,
 * with the name and size it had when the version was published.
 */
export const ProductVersionFileSchema = z.object({
	fileId: uuid,
	name: z.string().min(1).max(200),
	label: z.string().max(80),
	extension: z.string().max(11),
	bytes: z.number().int().min(0),
	mime: z.string().min(1).max(255),
});
export type ProductVersionFile = z.infer<typeof ProductVersionFileSchema>;

/** One row of `catalogue.product_versions`, every column. */
export const ProductVersionRowSchema = z.object({
	id: uuid,
	product_id: uuid,
	version: z.number().int().min(1),
	manifest: z.array(ProductVersionFileSchema).min(1).max(24),
	published_at: timestamptz,
	ready_at: timestamptz.nullable(),
	created_at: timestamptz,
});
export type ProductVersionRow = z.infer<typeof ProductVersionRowSchema>;

/** One row of `catalogue.entitlements`, every column. */
export const ProductEntitlementRowSchema = z.object({
	id: uuid,
	slug: EntitlementSlug,
	order_line_id: uuid,
	product_id: uuid.nullable(),
	version_id: uuid.nullable(),
	holder_type: EntitlementHolderType,
	holder_id: uuid,
	licence: ListingLicence,
	seats: z.number().int().min(1).max(999),
	/** Reserved for the later-versions rule; Phase 0 always writes NULL and never reads it. */
	updates_until: timestamptz.nullable(),
	status: EntitlementStatus,
	delivery_terms_accepted_at: timestamptz.nullable(),
	first_delivered_at: timestamptz.nullable(),
	created_at: timestamptz,
	updated_at: timestamptz,
});
export type ProductEntitlementRow = z.infer<typeof ProductEntitlementRowSchema>;
// #endregion

// #region Delivery address
/** The one route a bought file is fetched through: `GET|HEAD /api/downloads/[entitlement]/[fileId]`. */
export const DOWNLOAD_ROUTE = "/api/downloads";

/** The address of one file of a purchase. */
export function downloadHref(entitlementSlug: string, fileId: string): string {
	return `${DOWNLOAD_ROUTE}/${encodeURIComponent(entitlementSlug)}/${encodeURIComponent(fileId)}`;
}

/** The purchases view, optionally standing on one purchase (`&entitlement=`). */
export function purchasesHref(entitlementSlug?: string | null): string {
	return entitlementSlug
		? `/files?source=purchases&entitlement=${encodeURIComponent(entitlementSlug)}`
		: "/files?source=purchases";
}

/**
 * The purchases view standing on one purchase with its review dialog open (`&review=`, Decision #487
 * RV1). The order history and the purchases view link it, and an author's **Edit review** lands here
 * (`reviews.get_review_actions` builds the same address).
 */
export function purchaseReviewHref(entitlementSlug: string): string {
	return `${purchasesHref(entitlementSlug)}&review=${encodeURIComponent(entitlementSlug)}`;
}

/**
 * The review link a purchase offers, or `null`: a person's own purchase, still active, delivered at
 * least once (`first_delivered_at`). `reviews.submit_review` decides the rest. A business's purchase
 * offers none: its member holding `purchase` may review it through the door, but a list cannot tell
 * which members hold it, and a link that opens nothing is not offered.
 */
export function purchaseReviewLink(purchase: {
	slug: string;
	status: string;
	firstDeliveredAt: string | null;
	holderType: string;
}): string | null {
	return purchase.holderType === "user" && purchase.status === "active" && purchase.firstDeliveredAt
		? purchaseReviewHref(purchase.slug)
		: null;
}
// #endregion

// #region Purchase DTOs
/**
 * How a purchase's files stand: `ready` to download; `preparing` while the publish copy is still
 * landing in `originals` (the route answers 503 + Retry-After); `none` when the seller attached no file.
 */
export const PurchaseDelivery = z.enum(["ready", "preparing", "none"]);
export type PurchaseDelivery = z.infer<typeof PurchaseDelivery>;

/** One downloadable file of a purchase. */
export const PurchaseFileSchema = z.object({
	fileId: uuid,
	name: z.string().min(1).max(200),
	label: z.string().max(80),
	bytes: z.number().int().min(0),
	/** {@link downloadHref}; null when the purchase is not active or its files are not ready. */
	href: z.string().max(200).nullable(),
});
export type PurchaseFile = z.infer<typeof PurchaseFileSchema>;

/** One purchase, as the purchases view lists it. */
export const PurchaseSchema = z.object({
	slug: EntitlementSlug,
	title: z.string().min(1).max(200),
	orderReference: z.string().max(40).nullable(),
	purchasedAt: timestamptz,
	licence: ListingLicence,
	seats: z.number().int().min(1).max(999),
	status: EntitlementStatus,
	delivery: PurchaseDelivery,
	version: z.number().int().min(1).nullable(),
	firstDeliveredAt: timestamptz.nullable(),
	files: z.array(PurchaseFileSchema).max(24),
	/** {@link purchaseReviewLink}: where its review is written, or `null` when none is offered. */
	reviewHref: z.string().max(200).nullable(),
});
export type Purchase = z.infer<typeof PurchaseSchema>;

/** What the purchases view reads in one request. */
export const PurchaseListSchema = z.object({
	purchases: z.array(PurchaseSchema),
});
export type PurchaseList = z.infer<typeof PurchaseListSchema>;
// #endregion
