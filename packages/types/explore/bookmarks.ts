import { z } from "zod";

/**
 * explore.bookmarks — the Zod SSOT for saving a discovery card (the card's Star) to
 * `org.user_bookmarks`, through `GET|POST /api/explore/bookmark`.
 *
 * Items are addressed by their discovery id (slug or handle); the server resolves each to the
 * `org.bookmark_entity_type` row it stands for, so the database vocabulary never reaches the client.
 */

// #region Saveable entities
/**
 * The discovery types a person can save — the ones `org.bookmark_entity_type` can name: a service
 * (its blueprint), a project, and a freelancer, team or business profile. A product, an article and a
 * buyer's profile can be opened but not saved, so their cards render no Star.
 */
export const SaveableEntity = z.enum([
	"services",
	"projects",
	"freelancers",
	"teams",
	"businesses",
]);
export type SaveableEntity = z.infer<typeof SaveableEntity>;

/** Whether a discovery item of this type can be saved. */
export function isSaveableEntity(type: string): type is SaveableEntity {
	return SaveableEntity.safeParse(type).success;
}
// #endregion

// #region Transport
/** `POST /api/explore/bookmark` — the state the caller wants, so a repeated press is idempotent. */
export const BookmarkWriteSchema = z.object({
	itemId: z.string().min(1).max(200),
	saved: z.boolean(),
});
export type BookmarkWrite = z.infer<typeof BookmarkWriteSchema>;

/** The caller's saved items that the public catalogue still holds, as discovery ids. */
export const SavedItemsSchema = z.object({ itemIds: z.array(z.string()) });
export type SavedItems = z.infer<typeof SavedItemsSchema>;
// #endregion
