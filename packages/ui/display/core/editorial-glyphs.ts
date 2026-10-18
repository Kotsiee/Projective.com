/**
 * The editorial family's glyph seam.
 *
 * The server-rendered editorial components (`AnchorHeading`, the callout branch of
 * `ContentRenderer`) never import `Icon` themselves: `Icon` imports its stylesheet, and a module that
 * imports CSS cannot be loaded by `deno test`, which is where the family's render contract is pinned.
 * They read their glyphs from {@link EditorialGlyphContext} instead; a page provides the registry
 * set (`EDITORIAL_ICONS`, `@projective/ui/display/editorial-islands`) once at the top of the tree,
 * and a test renders with none. Every glyph is decorative — the word beside it carries the meaning
 * (§B.7.5), so a tree rendered without glyphs loses ornament, never information.
 *
 * The islands do NOT read this context: a context provided by a server component is absent when an
 * island hydrates, so an island that read it would render differently on the client than it did on
 * the server. `TableOfContents` imports its glyphs directly and passes them to `TocNav` as props.
 */
import { createContext } from "preact";
import type { VNode } from "preact";
import type { CalloutTone } from "@projective/types/content";

/** Produces one decorative glyph. A factory, so no VNode instance is shared between two positions. */
export type GlyphFactory = () => VNode;

/** The glyphs the editorial components can draw. Every slot is optional. */
export interface EditorialGlyphs {
	/** The trailing link mark an {@link AnchorHeading} reveals on hover / focus. */
	anchor?: GlyphFactory;
	/** The mark before each callout's tone word. */
	callout?: Partial<Record<CalloutTone, GlyphFactory>>;
	/** The table of contents' disclosure chevron. */
	disclosure?: GlyphFactory;
	/** The table of contents' bottom-sheet trigger mark. */
	sheet?: GlyphFactory;
}

/** Glyphs for the server-rendered editorial components. Defaults to none. */
export const EditorialGlyphContext = createContext<EditorialGlyphs>({});
