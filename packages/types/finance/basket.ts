import { z } from "zod";
import { currency, timestamp } from "./common.ts";
import { WalletOwnerType } from "./ledger.ts";
import { MoneyViewSchema } from "./wallet.ts";

/**
 * finance basket — the Zod SSOT for the purchasable vocabulary and the `/basket` read + write
 * projection that feeds checkout.
 *
 * **Money contract (inherited, not restated per surface).** Every figure is a
 * {@link MoneyViewSchema} — a server-computed integer minor-unit amount in the viewer's display
 * currency plus its pre-formatted label. The client renders a `MoneyView`; it never multiplies a unit
 * price by a quantity, never sums a subtotal, never applies a discount and never converts a currency
 * (CLAUDE.md Decisions #55/#60). The one arithmetic path both sides share lives in `checkout.ts`.
 *
 * **Identity fields are opaque references, not `uuid`.** The backing tables (`finance.baskets`,
 * `finance.basket_items`) key on `uuid`, but these schemas are READ PROJECTIONS, not row mirrors: they
 * carry derived display fields (`thumbnail`, `sellerName`, `href`, `scheduledLabel`) that no column
 * stores, and `item_id` is a polymorphic target — deliberately un-FK'd in the migration — whose
 * corpora are slug-keyed while the surfaces run on fixtures (`sv-brand-identity-sprint`,
 * `pj-helia-wallet-redesign`, `stage-2`) and UUID-keyed live. This follows the established split in
 * this package: row schemas (`WalletSchema`, `PaymentMethodSchema`) use `uuid`; projections
 * (`WalletRefSchema`, `LedgerLineSchema`) use an opaque string. Field NAMES and nullability mirror the
 * columns one-for-one, so going live is a resolver swap, not a shape change.
 *
 * Only enum/array/object/number/string/boolean primitives are used so the schemas stay stable across
 * Zod majors (matching `common.ts` and the sibling domains).
 */

// #region Reference primitive
/**
 * An opaque cross-domain identifier. Resolves to a `uuid` PK on the live path and to a slug in the
 * fixtures corpus; the surface treats it as an opaque token either way and never parses it.
 */
export const reference = z.string().min(1).max(120);

/**
 * A destination address for a digital deliverable. Uses the same permissive structure check as the
 * newsletter capture and the auth feature (`EMAIL_RE`) rather than a Zod format helper, so the shape
 * stays stable across Zod majors — the house rule this package is written to.
 */
export const destinationEmail = z.string().trim().regex(
	/^[^\s@]+@[^\s@]+\.[^\s@]+$/,
	"Enter a valid email address.",
).max(320);
// #endregion

// #region Owner axis
/**
 * The five principals whose money a basket, a saved card or a checkout may spend.
 *
 * This is {@link WalletOwnerType} **minus `system`**, and the narrowing is load-bearing rather than
 * stylistic: `finance.baskets.owner_type` and `finance.saved_cards.owner_type` both carry
 * `CHECK (owner_type IN ('user','freelancer','business','team','organisation'))`, so a schema that
 * accepted `system` would validate a write payload the database then refuses — a payload passing
 * validation and failing at INSERT is exactly the drift this package exists to prevent. The hidden
 * system wallets (Escrow Pool, Fee Collection, Dispute Lockbox) hold platform money and are never
 * issued a basket or a card.
 *
 * The `satisfies` clause makes this a **compile-time subset proof**: widening the wallet axis without
 * widening this one is fine, but adding a member here that the wallet axis does not have is a type
 * error rather than a silent divergence.
 */
const PURCHASE_OWNER_TYPES = [
	"user",
	"freelancer",
	"business",
	"team",
	"organisation",
] as const satisfies readonly WalletOwnerType[];

/** Whose money a purchase spends — {@link WalletOwnerType} without the platform's `system` wallets. */
export const PurchaseOwnerType = z.enum(PURCHASE_OWNER_TYPES);
export type PurchaseOwnerType = z.infer<typeof PurchaseOwnerType>;
// #endregion

// #region Purchasable vocabulary
/**
 * Everything the platform can sell. Mirrors the `finance.purchasable_item_kind` PG enum
 * **member-for-member and in this exact order** — the database and this package are one vocabulary,
 * not two that happen to agree, so adding a kind is a deliberate migration on both sides. The order is
 * also product → project → service → session, which is how a mixed basket groups.
 *
 * The three "ticket" members are the per-ticket pipeline purchases (a buyer chooses which stage the
 * ticket routes through); the "one-off" members are whole fixed-scope engagements; the three session
 * members are time-bound bookings. The delivery models map onto the discovery `ServiceType` vocabulary
 * (Pipeline · One-Off · Direct Deliverable · Session · Group Session, CLAUDE.md Decision #45) — this
 * enum is the *purchase* projection of it, which is why it also covers project-side and product
 * purchases that `ServiceType` does not describe.
 */
export const PurchasableItemKind = z.enum([
	"digital_product",
	"project_ticket",
	"one_off_project",
	"one_off_task",
	"service_ticket",
	"one_off_service",
	"single_service_task",
	"service_session",
	"set_session",
	"course_group_session",
]);
export type PurchasableItemKind = z.infer<typeof PurchasableItemKind>;

/**
 * The coarse family a purchasable belongs to. Drives the `/basket` page's categorised groups and the
 * checkout's adaptive row layout — four families rather than ten kinds, because a buyer reasons about
 * "my assets / my project work / my services / my bookings", not about delivery models.
 */
export const PurchasableItemGroup = z.enum(["product", "project", "service", "session"]);
export type PurchasableItemGroup = z.infer<typeof PurchasableItemGroup>;

/**
 * What a checkout row must collect and how it presents, per purchasable kind.
 *
 * This exists so the branching vocabulary lives in the SSOT exactly once. Without it the basket row,
 * the checkout line and the confirmation summary would each carry their own `switch` over ten kinds,
 * and the first added kind would be handled by two of the three.
 */
export interface ItemKindMeta {
	/** Human label for the kind ("Pipeline ticket", "Group session seat"). */
	label: string;
	/** The family this kind groups under. */
	group: PurchasableItemGroup;
	/** Whether the row must collect a delivery address for a digital deliverable. */
	needsEmail: boolean;
	/** Whether the row must resolve a booked slot (date · time · timezone) before it can be paid. */
	needsSchedule: boolean;
	/** Whether the row must resolve which stage the purchased ticket routes through. */
	needsStage: boolean;
}

const ITEM_KIND_META: Record<PurchasableItemKind, ItemKindMeta> = {
	digital_product: {
		label: "Digital product",
		group: "product",
		needsEmail: true,
		needsSchedule: false,
		needsStage: false,
	},
	project_ticket: {
		label: "Project ticket",
		group: "project",
		needsEmail: false,
		needsSchedule: false,
		needsStage: true,
	},
	one_off_project: {
		label: "One-off project",
		group: "project",
		needsEmail: false,
		needsSchedule: false,
		needsStage: false,
	},
	one_off_task: {
		label: "One-off task",
		group: "project",
		needsEmail: false,
		needsSchedule: false,
		needsStage: false,
	},
	service_ticket: {
		label: "Service ticket",
		group: "service",
		needsEmail: false,
		needsSchedule: false,
		needsStage: true,
	},
	one_off_service: {
		label: "One-off service",
		group: "service",
		needsEmail: false,
		needsSchedule: false,
		needsStage: false,
	},
	single_service_task: {
		label: "Direct deliverable",
		group: "service",
		needsEmail: false,
		needsSchedule: false,
		needsStage: false,
	},
	service_session: {
		label: "Session",
		group: "session",
		needsEmail: false,
		needsSchedule: true,
		needsStage: false,
	},
	set_session: {
		label: "Session package",
		group: "session",
		needsEmail: false,
		needsSchedule: true,
		needsStage: false,
	},
	course_group_session: {
		label: "Group session seat",
		group: "session",
		needsEmail: false,
		needsSchedule: true,
		needsStage: false,
	},
};

/**
 * The presentation + collection contract for a purchasable kind. Pure, total, and the single place any
 * surface may ask "what does this row need?".
 */
export function itemKindMeta(kind: PurchasableItemKind): ItemKindMeta {
	return ITEM_KIND_META[kind];
}
// #endregion

// #region Basket item
/**
 * One line in a basket.
 *
 * Field names and nullability mirror the `finance.basket_items` columns; everything after
 * `updatedAt` is the display projection the read resolves at the same time (seller identity, media,
 * the deep link, and the kind-specific facts a row needs to render — licence and format for a digital
 * product, the booked slot for a session, the routed stage for a ticket).
 *
 * **Three columns fold into two `MoneyView`s rather than appearing verbatim**, which is the money
 * contract above applied to this row and not an omission: `unit_price_minor` + `currency` become
 * {@link unitPrice}, and `discount_amount_minor` + the same `currency` become {@link discountAmount}.
 * A bare minor-unit integer beside a bare currency code is a figure the client would have to format,
 * and a client-formatted figure is precisely what a `MoneyView` exists to prevent.
 *
 * **The `max()` bounds on the free-text snapshots (`title`, `subtitle`, `discountCode`) are tighter
 * than their columns**, which are unbounded `text` (the schema carries no length CHECKs anywhere).
 * They are therefore a **truncation contract the resolving service must honour** — a snapshot taken
 * from a longer catalogue title must be truncated on the way in, because a row that exceeds them
 * would fail to parse on the way out and take the whole basket read with it.
 *
 * **The price fields have one defined relationship, and the client must not re-derive it:**
 * `lineTotal = unitPrice × quantity − discountAmount`. `unitPrice` is the charged per-unit price,
 * `originalPrice` the struck-through pre-discount price when the creator is running one, and
 * `discountAmount` the creator discount across the whole quantity. Summing `lineTotal` across selected
 * rows therefore yields the subtotal *net of creator discounts* — which is why
 * {@link basketSubtotal} sums `unitPrice × quantity` instead, and reports the creator discount as its
 * own line rather than silently folding it in.
 */
export const BasketItemSchema = z.object({
	id: reference,
	basketId: reference,
	itemType: PurchasableItemKind,
	/** The purchasable this line points at (a listing, a project, a ticket template, a session). */
	itemId: reference,
	/** Which stage a purchased ticket routes through; `null` for every kind whose meta says so. */
	stageId: reference.nullable(),
	/** The revision this line re-purchases, when the line is a paid revision; else `null`. */
	revisionId: reference.nullable(),
	title: z.string().min(1).max(200),
	/** Secondary line ("Standard licence · FBX", "Stage 2 · Design system"). */
	subtitle: z.string().max(200).nullable(),
	unitPrice: MoneyViewSchema,
	quantity: z.number().int().min(1).max(999),
	/** The promo/creator code attached to THIS line, when one applies; basket-wide promos live on {@link BasketSchema}. */
	discountCode: z.string().max(40).nullable(),
	/** The creator discount on this line across the whole quantity. Zero-valued, never `null`, so the arithmetic has no branch. */
	discountAmount: MoneyViewSchema,
	/** `unitPrice × quantity − discountAmount`, computed SERVER-side. */
	lineTotal: MoneyViewSchema,
	isSelectedForCheckout: z.boolean(),
	savedForLater: z.boolean(),
	/** Where a digital deliverable is sent. Required when {@link itemKindMeta} says `needsEmail`. */
	destinationEmail: destinationEmail.nullable(),
	/** Free-form line context the purchase flow round-trips (seat selection, variant, brief ref). */
	metadata: z.record(z.string(), z.unknown()),
	createdAt: timestamp,
	updatedAt: timestamp,

	/** Cover image; `null` → the row renders the kind glyph. */
	thumbnail: z.string().max(600).nullable(),
	/** The seller's `@handle` — the canonical `/@handle` link (CLAUDE.md Decision #3). */
	sellerHandle: z.string().max(40).nullable(),
	sellerName: z.string().max(120).nullable(),
	/** Deep link back to the purchasable (`/view/[id]`, `/projects/…`). */
	href: z.string().max(200).nullable(),
	/** The struck-through pre-discount unit price when a creator discount is running; else `null`. */
	originalPrice: MoneyViewSchema.nullable(),
	/** Digital product licence tier ("Standard licence", "Extended licence"). */
	licence: z.string().max(80).nullable(),
	/** Digital product delivery format ("FBX + 4K textures", "PDF"). */
	format: z.string().max(80).nullable(),
	/** The booked slot for a session line (ISO); `null` until the buyer picks one. */
	scheduledAt: timestamp.nullable(),
	/** Pre-formatted slot label ("Tue 12 Aug · 14:00–15:00"), so SSR and the refetch agree. */
	scheduledLabel: z.string().max(80).nullable(),
	/** IANA timezone the slot is expressed in. */
	timezone: z.string().max(64).nullable(),
	/** Resolved stage name for a ticket line ("Stage 2 · Design system"). */
	stageLabel: z.string().max(120).nullable(),
	/** Seats held on a group-session line; `null` for every other kind. */
	seats: z.number().int().min(1).max(500).nullable(),
	/**
	 * Whether the line can still be bought. A basket outlives its contents — a listing gets delisted, a
	 * slot gets taken, a project closes — so staleness is a first-class state rather than a checkout
	 * failure discovered at payment.
	 */
	available: z.boolean(),
	/** Why the line cannot be bought; `null` while {@link available}. */
	unavailableReason: z.string().max(200).nullable(),
});
export type BasketItem = z.infer<typeof BasketItemSchema>;
// #endregion

// #region Groups + basket
/**
 * A server-computed category of lines within one basket ("Project Alpha tickets", "Consultation
 * sessions"). Carries `itemIds` rather than nested items so {@link BasketSchema.items} stays the one
 * canonical row list — a group is an index over it, and a line can never disagree with itself.
 */
export const BasketGroupSchema = z.object({
	id: reference,
	group: PurchasableItemGroup,
	/** Server-resolved heading ("Project Alpha tickets" from the project name). */
	label: z.string().min(1).max(120),
	/** Optional supporting line ("3 tickets · Helia wallet redesign"). */
	caption: z.string().max(160).nullable(),
	/** Ids of the {@link BasketItemSchema} rows in this group, in display order. */
	itemIds: z.array(reference).max(200),
	itemCount: z.number().int().min(0),
	/** How many of {@link itemIds} are currently selected for checkout. */
	selectedCount: z.number().int().min(0),
	/** Sum of the group's SELECTED lines, computed server-side. */
	subtotal: MoneyViewSchema,
	/** Deep link to the project/service this group is anchored to; `null` for a loose category. */
	href: z.string().max(200).nullable(),
});
export type BasketGroup = z.infer<typeof BasketGroupSchema>;

/**
 * A named basket belonging to one owner. A buyer may keep several (`isDefault` marks the one an
 * add-to-basket lands in); an entity's basket spends the entity's money, which is what makes
 * `ownerType` load-bearing rather than decorative — it is the input to
 * {@link availableProviders}.
 */
export const BasketSchema = z.object({
	id: reference,
	ownerType: PurchaseOwnerType,
	ownerId: reference,
	name: z.string().min(1).max(120),
	isDefault: z.boolean(),
	/** The display currency every {@link MoneyViewSchema} in this basket is projected in. */
	currency,
	items: z.array(BasketItemSchema).max(200),
	/** Server-computed categorisation over {@link items}; the client never groups. */
	groups: z.array(BasketGroupSchema).max(40),
	/** Sum of every SELECTED, available line before discounts. */
	subtotal: MoneyViewSchema,
	/** Total creator discounts across the selected lines. */
	creatorDiscounts: MoneyViewSchema,
	/** `subtotal − creatorDiscounts` — what a promo code and the fee are then applied against. */
	net: MoneyViewSchema,
	itemCount: z.number().int().min(0),
	selectedCount: z.number().int().min(0),
	savedForLaterCount: z.number().int().min(0),
	/** How many lines have gone stale since they were added (drives the basket's warning state). */
	unavailableCount: z.number().int().min(0),
	createdAt: timestamp,
	updatedAt: timestamp,
});
export type Basket = z.infer<typeof BasketSchema>;

// #region Lists (the lane's navigation projection)
/**
 * What a list in the basket lane actually is.
 *
 * **A user-defined "list" is a named basket, not a new concept.** `finance.baskets` has always been
 * multi-row per owner with one `is_default` — the shape a "Save for Later" or "3D Assets" list needs
 * already exists, and inventing a parallel `finance.lists` table would give the platform two places
 * a purchasable can sit and two answers to "what is in my basket".
 *
 * `ticket` and `session` entries are **derived, not stored**: they are an index over the active
 * basket's lines grouped by the engagement they belong to, which is why they have no id of their own
 * beyond the engagement's and cannot be renamed or deleted. Modelling them as real lists would let a
 * buyer "delete" a grouping and appear to delete the tickets inside it.
 */
export const BasketListKind = z.enum([
	/** A real `finance.baskets` row the buyer named. */
	"basket",
	/** The parked shelf — `saved_for_later` lines across the owner's baskets. */
	"saved",
	/** Derived: the active basket's ticket lines for one project or service. */
	"ticket",
	/** Derived: the active basket's session lines for one service. */
	"session",
]);
export type BasketListKind = z.infer<typeof BasketListKind>;

/** One selectable destination in the basket lane's list explorer. */
export const BasketListEntrySchema = z.object({
	id: reference,
	kind: BasketListKind,
	label: z.string().min(1).max(120),
	/** Supporting line ("4 tickets · Helia wallet redesign"); `null` when the label says enough. */
	caption: z.string().max(160).nullable(),
	itemCount: z.number().int().min(0),
	/** The running total of this list's checkout-eligible lines, computed SERVER-side. */
	subtotal: MoneyViewSchema,
	/** Where selecting it navigates. */
	href: z.string().max(200),
	/** Whether this is the owner's default basket — an add-to-basket lands here. */
	isDefault: z.boolean(),
	/** Whether a buyer may check out directly from this list. Derived groupings can; the shelf cannot. */
	checkoutable: z.boolean(),
	/** Avatar or cover for an engagement-derived entry; `null` for a plain list. */
	thumbnail: z.string().max(600).nullable(),
});
export type BasketListEntry = z.infer<typeof BasketListEntrySchema>;

/**
 * The lane's whole navigation model: the buyer's own lists, then the two collapsible
 * engagement-derived groups.
 *
 * Server-computed in one pass so the three sections cannot disagree about a line's membership — a
 * ticket that appears under its project must be the same row the basket counts.
 */
export const BasketListsSchema = z.object({
	/** Named baskets, default first, plus the parked shelf as the trailing entry. */
	lists: z.array(BasketListEntrySchema).max(40),
	/** One entry per project or service with ticket lines in the active basket. */
	tickets: z.array(BasketListEntrySchema).max(40),
	/** One entry per service with session lines in the active basket. */
	sessions: z.array(BasketListEntrySchema).max(40),
	/** The entry the current URL addresses, so the lane paints its active row on the first byte. */
	activeId: reference.nullable(),
	/** The running total of the ACTIVE list — the lane footer's figure. */
	activeSubtotal: MoneyViewSchema,
	/** The active list's checkout destination, for the lane footer's CTA. */
	activeCheckoutHref: z.string().max(200),
});
export type BasketLists = z.infer<typeof BasketListsSchema>;

/** Create a new named list. `name` is bounded to the `finance.baskets.name` projection bound. */
export const CreateBasketListSchema = z.object({
	name: z.string().trim().min(1).max(120),
	ownerType: PurchaseOwnerType.optional(),
	ownerId: reference.optional(),
});
export type CreateBasketList = z.infer<typeof CreateBasketListSchema>;
// #endregion

/** The basket list a buyer switches between (several named baskets, one default). */
export const BasketSummarySchema = z.object({
	id: reference,
	name: z.string().min(1).max(120),
	isDefault: z.boolean(),
	ownerType: PurchaseOwnerType,
	ownerId: reference,
	itemCount: z.number().int().min(0),
	subtotal: MoneyViewSchema,
	updatedAt: timestamp,
});
export type BasketSummary = z.infer<typeof BasketSummarySchema>;
// #endregion

// #region Basket write payloads
/**
 * Add a purchasable to a basket. `basketId` is nullable so an add-to-basket from anywhere on the
 * platform lands in the owner's default basket without the caller first resolving which that is.
 */
export const AddBasketItemSchema = z.object({
	basketId: reference.nullable(),
	/** Whose money this basket spends — an entity add is refused server-side for a non-member. */
	ownerType: PurchaseOwnerType.optional(),
	ownerId: reference.optional(),
	itemType: PurchasableItemKind,
	itemId: reference,
	stageId: reference.nullable().optional(),
	revisionId: reference.nullable().optional(),
	quantity: z.number().int().min(1).max(999).optional(),
	destinationEmail: destinationEmail.nullable().optional(),
	scheduledAt: timestamp.nullable().optional(),
	timezone: z.string().max(64).nullable().optional(),
	seats: z.number().int().min(1).max(500).nullable().optional(),
	metadata: z.record(z.string(), z.unknown()).optional(),
});
export type AddBasketItem = z.infer<typeof AddBasketItemSchema>;

/** Patch one line. Every field but the id is optional; an omitted field is left untouched. */
export const UpdateBasketItemSchema = z.object({
	basketItemId: reference,
	quantity: z.number().int().min(1).max(999).optional(),
	isSelectedForCheckout: z.boolean().optional(),
	savedForLater: z.boolean().optional(),
	destinationEmail: destinationEmail.nullable().optional(),
	scheduledAt: timestamp.nullable().optional(),
	timezone: z.string().max(64).nullable().optional(),
	stageId: reference.nullable().optional(),
	seats: z.number().int().min(1).max(500).nullable().optional(),
	metadata: z.record(z.string(), z.unknown()).optional(),
});
export type UpdateBasketItem = z.infer<typeof UpdateBasketItemSchema>;

/**
 * Move a line between baskets, or between the active list and saved-for-later. Nothing is hard-deleted
 * by a move (root CLAUDE.md §5): `savedForLater` parks a line, it does not remove it.
 */
export const MoveBasketItemSchema = z.object({
	basketItemId: reference,
	/** Destination basket; `null` moves to the owner's default basket. */
	toBasketId: reference.nullable(),
	/** Park or un-park the line while moving it. */
	savedForLater: z.boolean().optional(),
	/** Position within the destination basket, when the caller is reordering. */
	position: z.number().int().min(0).max(999).optional(),
});
export type MoveBasketItem = z.infer<typeof MoveBasketItemSchema>;

/** Remove a line outright (the explicit user action, distinct from parking it). */
export const RemoveBasketItemSchema = z.object({
	basketItemId: reference,
});
export type RemoveBasketItem = z.infer<typeof RemoveBasketItemSchema>;

/** Apply a promotional code to a whole basket. `code: null` clears the applied promo. */
export const ApplyPromoCodeSchema = z.object({
	basketId: reference,
	code: z.string().trim().min(1).max(40).nullable(),
});
export type ApplyPromoCode = z.infer<typeof ApplyPromoCodeSchema>;

/** The outcome of applying a code — valid or not, the resolved saving, and why when it failed. */
export const AppliedPromoSchema = z.object({
	code: z.string().max(40),
	/** Display label ("SUMMER20 · 20% off services"). */
	label: z.string().max(120),
	valid: z.boolean(),
	/** The saving this code produces against the current basket; zero-valued when invalid. */
	amount: MoneyViewSchema,
	/** Why the code was refused ("Expired on 30 June"); `null` when {@link valid}. */
	message: z.string().max(200).nullable(),
});
export type AppliedPromo = z.infer<typeof AppliedPromoSchema>;
// #endregion
