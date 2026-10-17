/**
 * `@projective/ui/display/editorial` — the editorial reading family's server-rendered half, as its
 * own sub-path: DocumentLayout, DocumentHeader, DocumentBody, Prose, ContentRenderer, InlineContent,
 * AnchorHeading, TocNav / TocList, the glyph context and the pure scroll geometry.
 *
 * Nothing behind this door imports a stylesheet or `Icon`, so it loads under `deno test` — a surface
 * can render a whole document to a string and assert on it. The styles arrive through
 * `display/styles/editorial.css` (imported by the app's client entry and by both islands). The
 * interactive half — the `TableOfContents` and `ReadingProgress` islands and the registry glyph set —
 * is `@projective/ui/display/editorial-islands`. `@projective/ui/display` re-exports both.
 */

// #region Layout
export { DocumentLayout } from "./components/DocumentLayout.tsx";
export type { DocumentLayoutProps } from "./components/DocumentLayout.tsx";
export { DocumentHeader } from "./components/DocumentHeader.tsx";
export type { DocumentHeaderProps } from "./components/DocumentHeader.tsx";
export { DocumentBody } from "./components/DocumentBody.tsx";
export type { DocumentBodyProps } from "./components/DocumentBody.tsx";
// #endregion

// #region Prose & content
export { Prose } from "./components/Prose.tsx";
export type { ProseProps } from "./components/Prose.tsx";
export { ContentRenderer } from "./components/ContentRenderer.tsx";
export type { ContentRendererProps } from "./components/ContentRenderer.tsx";
export { InlineContent } from "./components/InlineContent.tsx";
export type { InlineContentProps } from "./components/InlineContent.tsx";
export { AnchorHeading } from "./components/AnchorHeading.tsx";
export type { AnchorHeadingProps } from "./components/AnchorHeading.tsx";
export { EditorialGlyphContext } from "./core/editorial-glyphs.ts";
export type { EditorialGlyphs, GlyphFactory } from "./core/editorial-glyphs.ts";
// #endregion

// #region Table of contents
export { TocList, TocNav } from "./components/TocNav.tsx";
export type { TocListProps, TocNavProps } from "./components/TocNav.tsx";
export {
	motionReduced,
	pickActiveHeading,
	readingLineFor,
	readingRatio,
	tocIds,
	tocText,
} from "./core/scroll-spy.ts";
export type { HeadingPosition, ReadingGeometry, ReadingLine } from "./core/scroll-spy.ts";
// #endregion
