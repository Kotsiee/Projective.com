/**
 * `@projective/ui/display/editorial-islands` — the editorial family's interactive half: the
 * `TableOfContents` and `ReadingProgress` islands, and `EDITORIAL_ICONS`, the registry glyph set a
 * page provides to `EditorialGlyphContext`.
 *
 * Both islands live in this package's `islands/` folder, which the app's Vite config registers, so a
 * SERVER component may render them directly and they hydrate. Each imports the editorial aggregate
 * stylesheet, which carries the whole family's CSS into any page that mounts one. Everything here
 * imports a stylesheet (through `Drawer` or `Icon`), so it does not load under `deno test`; the
 * stylesheet-free half is `@projective/ui/display/editorial`.
 */
export { default as TableOfContents } from "./islands/TableOfContents.island.tsx";
export type { TableOfContentsProps } from "./islands/TableOfContents.island.tsx";
export { default as ReadingProgress } from "./islands/ReadingProgress.island.tsx";
export type { ReadingProgressProps } from "./islands/ReadingProgress.island.tsx";
export { EDITORIAL_ICONS } from "./core/editorial-icons.tsx";
