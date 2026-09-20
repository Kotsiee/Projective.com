/**
 * Rich text — the plain-text projection every formatted body is stored beside.
 *
 * @module
 */
export {
	flattenRichText,
	hasRichTextProse,
	plainTextToHtml,
	type RichTextDelta,
	type RichTextDeltaOp,
	type RichTextInput,
} from "./plain-text.ts";
