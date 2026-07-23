/**
 * @projective/ui/editor — rich-text editing.
 *
 * A single, deliberately stripped QuillJS wrapper. Token-only theming (Quill's `snow`/`bubble`
 * themes are not imported), so the sub-path stays copy-paste portable like the rest of the umbrella.
 * See DESIGN_SYSTEM.md §C.1 (editor roster).
 */
export { RichTextEditor } from "./islands/RichTextEditor.tsx";
export type { RichTextEditorProps } from "./islands/RichTextEditor.tsx";
