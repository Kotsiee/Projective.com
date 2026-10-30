/**
 * The articles surface's glyph seam — the same pattern as the editorial family's
 * `EditorialGlyphContext` (`@projective/ui/display`).
 *
 * The server-rendered article views never import `Icon` themselves: `Icon` imports its stylesheet, and
 * a module that imports CSS cannot be loaded by `deno test`, where `articles-render.test.tsx` pins the
 * views' markup. The views read their glyphs from {@link ArticleGlyphContext}; each route provides the
 * registry set (`ARTICLE_ICONS`, `components/article-icons.tsx`) once at the top of its tree, and a
 * test renders with none. Every glyph is decorative — the word beside it carries the meaning (§B.7.5).
 */
import { createContext } from "preact";
import type { VNode } from "preact";

/** Produces one decorative glyph. A factory, so no VNode instance is shared between two positions. */
export type ArticleGlyphFactory = () => VNode;

/** The glyphs the article views can draw. Every slot is optional. */
export interface ArticleGlyphs {
	/** Before "Previous" and "All articles". */
	back?: ArticleGlyphFactory;
	/** After "Next". */
	forward?: ArticleGlyphFactory;
	/** The check inside a chosen topic chip. */
	chosen?: ArticleGlyphFactory;
}

/** Glyphs for the server-rendered article views. Defaults to none. */
export const ArticleGlyphContext = createContext<ArticleGlyphs>({});
