import { z } from "zod";

/**
 * files.kinds — the coarse rendering bucket every asset falls into.
 *
 * This is a deliberate LEAF module: it imports nothing, so it can be depended on by both
 * {@link ./categories.ts} (which maps its rich 28-value taxonomy down onto these 8) and
 * {@link ./assets.ts} (which renders from them) without closing an import cycle.
 *
 * It previously lived in `../projects/files.ts`, which made the dependency graph point the wrong
 * way — `files/categories.ts` had to reach INTO the projects domain for the vocabulary the files
 * domain owns, while `projects/files.ts` reached back for `FileCategory`. That mutual edge survived
 * only because one side used `import type` (erased at runtime). Rather than stack a third edge on
 * it, the vocabulary moved down here and `projects/files.ts` re-exports it, so every existing
 * `import { FileKind } from "@projective/types/projects"` keeps resolving unchanged.
 *
 * Where {@link FileCategory} answers "what KIND of thing is this?" (search, faceting, analytics),
 * `FileKind` answers "how do I draw and preview it?" — it selects the category glyph in the
 * grid/list and the inline renderer in the preview modal.
 */

// #region Kind

/**
 * The asset rendering bucket — a superset of `MessageAttachmentKind` that adds `audio` (voice notes
 * / sound files), `code` (syntax-highlightable text), `doc` (office documents), `archive`, and
 * `link` (a web link stored as a first-class asset, rendered as a favicon + host card).
 */
export const FileKind = z.enum([
	"image",
	"video",
	"audio",
	"pdf",
	"doc",
	"code",
	"archive",
	"link",
	"file",
]);
export type FileKind = z.infer<typeof FileKind>;

// #endregion
