import { z } from "zod";
import { timestamp } from "./common.ts";
import { PurchasableItemKind, reference } from "./basket.ts";
import { MoneyViewSchema } from "./wallet.ts";
import { OrderStatus } from "./order.ts";

/**
 * finance order history — the Zod SSOT for `/checkout/orders` (MARKETPLACE CK3): every order the acting
 * account placed, newest first, a page at a time, each line linked to where it now lives.
 *
 * **A history row reprints the receipt's facts, never recomputes them.** Its figures are the order's
 * own `MoneyView`s in the currency charged; the receipt itself is the confirmation view the row opens.
 *
 * **Pages are keyset windows, not offsets.** `older` / `newer` are opaque boundary tokens the server
 * mints and alone reads (`?after=` / `?before=`, ROUTING.md); a client never builds one.
 */

// #region Line
/** Where one purchased line lives now, and the words its link reads as. */
export const OrderLineHomeSchema = z.object({
	/**
	 * A download: the purchases view standing on its purchase (`/files?source=purchases&entitlement=`).
	 * An engagement: its project or stage. A session or seat: the session's workspace.
	 */
	href: z.string().max(600),
	label: z.string().max(120),
});
export type OrderLineHome = z.infer<typeof OrderLineHomeSchema>;

/** One line of a past order, as the history lists it. */
export const OrderHistoryLineSchema = z.object({
	id: reference,
	itemType: PurchasableItemKind,
	title: z.string().min(1).max(200),
	lineTotal: MoneyViewSchema,
	/** `null` when the line has no home the buyer can open (a ticket whose stage is gone, a product with no files). */
	home: OrderLineHomeSchema.nullable(),
	/**
	 * A delivered product line's review, on the purchases view (`purchaseReviewLink`, Decision #487
	 * RV1); `null` for every other line, and for a purchase not offered one.
	 */
	reviewHref: z.string().max(200).nullable(),
});
export type OrderHistoryLine = z.infer<typeof OrderHistoryLineSchema>;
// #endregion

// #region Entry
/** One past order. */
export const OrderHistoryEntrySchema = z.object({
	id: reference,
	reference: z.string().max(40),
	status: OrderStatus,
	placedAt: timestamp,
	/** Pre-formatted placement stamp, the receipt's own. */
	placedAtLabel: z.string().max(80),
	total: MoneyViewSchema,
	lines: z.array(OrderHistoryLineSchema).max(200),
});
export type OrderHistoryEntry = z.infer<typeof OrderHistoryEntrySchema>;
// #endregion

// #region Page
/** The most orders one history page lists. */
export const ORDER_HISTORY_PAGE_SIZE = 20;

/** One account whose orders the caller may list, as the history's owner switch names it. */
export const OrderHistoryOwnerSchema = z.object({
	/** The `?owner=` scope key (`personal` · `team:{id}` · `business:{id}` · `enterprise:{id}`). */
	key: z.string().max(80),
	name: z.string().max(120),
});
export type OrderHistoryOwner = z.infer<typeof OrderHistoryOwnerSchema>;

/** One page of the acting account's order history. */
export const OrderHistoryPageSchema = z.object({
	/** The scope key this page is read under. */
	ownerKey: z.string().max(80),
	/** Whose orders these are: the person, or the team or business the page is scoped to. */
	ownerName: z.string().max(120),
	/** Every account the caller may switch the history to, this one included; the basket's owner list. */
	owners: z.array(OrderHistoryOwnerSchema).max(50),
	entries: z.array(OrderHistoryEntrySchema).max(50),
	/** The boundary of the next page back (`?after=`), or `null` on the oldest page. */
	older: z.string().max(200).nullable(),
	/** The boundary of the page before this one (`?before=`), or `null` on the newest page. */
	newer: z.string().max(200).nullable(),
});
export type OrderHistoryPage = z.infer<typeof OrderHistoryPageSchema>;
// #endregion
