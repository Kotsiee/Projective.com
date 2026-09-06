/**
 * @projective/ui/editor — rich-text editing.
 *
 * A single, deliberately stripped QuillJS wrapper. Token-only theming (Quill's `snow`/`bubble`
 * themes are not imported), so the sub-path stays copy-paste portable like the rest of the umbrella.
 * See DESIGN_SYSTEM.md §C.1 (editor roster).
 *
 * The two `core/` modules are exported alongside the component because they are pure and useful on
 * their own: a surface that accepts Markdown somewhere other than a paste can reuse the same
 * conversion, and the same conversion is what keeps the two behaviours from drifting apart.
 */
export { RichTextEditor } from "./islands/RichTextEditor.tsx";
export type { RichTextEditorProps } from "./islands/RichTextEditor.tsx";
export {
	htmlCarriesFormatting,
	looksLikeMarkdown,
	markdownToHtml,
	shouldParseMarkdown,
} from "./core/markdown.ts";
export type { ResizeAxis } from "./core/resize.ts";
