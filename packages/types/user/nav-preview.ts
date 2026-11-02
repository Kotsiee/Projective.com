import { z } from "zod";

/**
 * Nav previews — the rows a right-click on a rail destination lists (Decision #370): the viewer's top
 * conversations, projects, listings, teams or businesses, with what they saved or starred pinned
 * first. A read projection over the existing list reads; no table of its own.
 */

// #region Kinds
/** The rail destinations that preview their contents. */
export const NavPreviewKind = z.enum(["messages", "projects", "catalogue", "teams", "businesses"]);
export type NavPreviewKind = z.infer<typeof NavPreviewKind>;

/** Most rows one preview lists. */
export const NAV_PREVIEW_LIMIT = 3;
// #endregion

// #region Rows
/** One preview row. */
export const NavPreviewItemSchema = z.object({
	/** What the destination's route addresses: a conversation id, project slug, listing id or handle. */
	ref: z.string().min(1).max(200),
	title: z.string().min(1).max(200),
	/** Avatar, logo or cover; `null` paints the title's initials. */
	image: z.string().max(600).nullable(),
	/** One line: the latest message, what awaits the viewer, the category, the viewer's role. */
	detail: z.string().max(200),
	/** Last activity (ISO), drawn as a relative time; `null` when unknown. */
	at: z.string().nullable(),
	/** Saved or starred by the viewer — listed above the ranking. */
	pinned: z.boolean(),
});
export type NavPreviewItem = z.infer<typeof NavPreviewItemSchema>;

/** `GET /api/nav/preview?kind=` — one destination's rows, pinned first, at most {@link NAV_PREVIEW_LIMIT}. */
export const NavPreviewSchema = z.object({
	kind: NavPreviewKind,
	items: z.array(NavPreviewItemSchema).max(NAV_PREVIEW_LIMIT),
});
export type NavPreview = z.infer<typeof NavPreviewSchema>;
// #endregion
