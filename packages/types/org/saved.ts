import { z } from "zod";

/**
 * Saved — the one saved / favourites system behind `/saved` and every star or save control
 * (Decision #180).
 *
 * A save is stored where its kind already keeps one, one store per kind: listings, people and project
 * channels are `org.user_bookmarks` rows (fileable into `org.user_bookmark_collections`); a project is
 * its star (`projects.user_preferences.is_starred`); a conversation is its participant star
 * (`comms.dm_participants.is_starred`, set through `comms.set_dm_starred`); a message is a
 * `comms.message_favorites` row; a file is its owner's mark (`files.items.starred`). Follows are not
 * saves — they stay `org.profile_follows` — but the People tab lists them under "People you follow".
 */

// #region Kinds and tabs
/** Every kind of thing a person can save. */
export const SavedEntityType = z.enum([
	"service",
	"product",
	"article",
	"profile",
	"project",
	"project_channel",
	"conversation",
	"message",
	"file",
]);
export type SavedEntityType = z.infer<typeof SavedEntityType>;

/** The `/saved` tabs, in display order. */
export const SavedTab = z.enum(["all", "listings", "people", "projects", "messages", "files"]);
export type SavedTab = z.infer<typeof SavedTab>;

/** Which kinds each tab lists (`all` lists every kind). */
export const SAVED_TAB_TYPES: Readonly<
	Record<Exclude<SavedTab, "all">, readonly SavedEntityType[]>
> = {
	listings: ["service", "product", "article"],
	people: ["profile"],
	projects: ["project"],
	messages: ["conversation", "project_channel", "message"],
	files: ["file"],
};

/** Kinds that are bookmark rows, and so can be filed into a collection. */
export const COLLECTABLE_TYPES: readonly SavedEntityType[] = [
	"service",
	"product",
	"article",
	"profile",
	"project_channel",
];
// #endregion

// #region Writes
/**
 * The key a surface already routes by: a slug for a service, product, article or project, a handle
 * for a profile, and an id for a channel, conversation, message or file. The service resolves it.
 */
export const SavedRef = z.string().trim().min(1).max(200);

/** Save or un-save one thing. Idempotent: the desired state, never a flip. */
export const SavedToggleSchema = z.object({
	type: SavedEntityType,
	ref: SavedRef,
	saved: z.boolean(),
	/** Bookmark kinds only: file the save into this collection (`null` = unfiled). Absent = unchanged. */
	collectionId: z.string().uuid().nullable().optional(),
});
export type SavedToggle = z.infer<typeof SavedToggleSchema>;

/** What a save write answers. */
export const SavedStateSchema = z.object({
	saved: z.boolean(),
	collectionId: z.string().uuid().nullable(),
});
export type SavedState = z.infer<typeof SavedStateSchema>;

/** Create a collection. */
export const SavedCollectionCreateSchema = z.object({
	name: z.string().trim().min(1).max(60),
});
export type SavedCollectionCreate = z.infer<typeof SavedCollectionCreateSchema>;
// #endregion

// #region Reads
/** One saved thing, resolved for display whatever store it lives in. */
export const SavedItemSchema = z.object({
	type: SavedEntityType,
	ref: SavedRef,
	title: z.string(),
	/** One line of inline metadata (kind · owner or place), never chips. */
	meta: z.string(),
	thumbnail: z.string().nullable(),
	/** `null` when the thing is gone or no longer visible — the row stays so it can be removed. */
	href: z.string().nullable(),
	savedAt: z.string().nullable(),
	collectionId: z.string().uuid().nullable(),
	/** A "People you follow" row: removing it unfollows (`/api/profile/[handle]/follow`). */
	following: z.boolean(),
});
export type SavedItem = z.infer<typeof SavedItemSchema>;

/**
 * A named collection — a "list" in the UI. `count` and `covers` (up to four thumbnails, newest first)
 * are present where the read draws list boards (`/saved`), and absent on the bare read a save menu uses.
 */
export const SavedCollectionSchema = z.object({
	id: z.string().uuid(),
	name: z.string(),
	count: z.number().int().min(0).optional(),
	covers: z.array(z.string()).max(4).optional(),
});
export type SavedCollection = z.infer<typeof SavedCollectionSchema>;

/**
 * `POST /api/saved/collections/:id/basket` — put a list's purchasable items into a basket: an existing
 * one (`basketId`, `null` = the default) or a new named one (`newBasketName`).
 */
export const SavedListToBasketSchema = z.object({
	basketId: z.string().uuid().nullable().optional(),
	newBasketName: z.string().trim().min(1).max(120).optional(),
}).refine((v) => !(v.basketId && v.newBasketName), {
	message: "Choose a basket or name a new one, not both.",
	path: ["newBasketName"],
});
export type SavedListToBasket = z.infer<typeof SavedListToBasketSchema>;

/** One list item the bulk add could not place, with where to finish it. */
export const SavedListSkipSchema = z.object({
	title: z.string(),
	href: z.string().nullable(),
	reason: z.string(),
});
export type SavedListSkip = z.infer<typeof SavedListSkipSchema>;

/** What the bulk add answers: the basket it filled, what landed, and what needs a step of its own. */
export const SavedListToBasketResultSchema = z.object({
	basketId: z.string().nullable(),
	added: z.array(z.string()),
	skipped: z.array(SavedListSkipSchema),
});
export type SavedListToBasketResult = z.infer<typeof SavedListToBasketResultSchema>;

/** `GET /api/saved` query. `collection` narrows the bookmark kinds to one collection or the unfiled. */
export const SavedListParamsSchema = z.object({
	tab: SavedTab.default("all"),
	collection: z.union([z.literal("unfiled"), z.string().uuid()]).optional(),
	cursor: z.string().regex(/^\d{1,6}$/).optional(),
	limit: z.coerce.number().int().min(1).max(60).default(30),
});
export type SavedListParams = z.infer<typeof SavedListParamsSchema>;

/** One page of saved things plus the caller's collections. */
export const SavedPageSchema = z.object({
	items: z.array(SavedItemSchema),
	nextCursor: z.string().nullable(),
	collections: z.array(SavedCollectionSchema),
});
export type SavedPage = z.infer<typeof SavedPageSchema>;

/** `GET /api/saved/state?keys=` — which of these `type:ref` keys the caller has saved. */
export const SavedKey = z.string().regex(/^[a-z_]+:.{1,200}$/);
export const SavedStateQuerySchema = z.object({
	keys: z.array(SavedKey).min(1).max(100),
});
export type SavedStateQuery = z.infer<typeof SavedStateQuerySchema>;

/** The `type:ref` key the state lookup and the client cache use. */
export function savedKey(type: SavedEntityType, ref: string): string {
	return `${type}:${ref}`;
}
// #endregion
