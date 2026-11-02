/**
 * Rich text — the plain-text projection every formatted body is stored beside, and the sanitiser
 * every body one person writes for another to read passes through.
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
export { sanitizeRichText } from "./sanitize.ts";
