/**
 * docx-runtime — docx-preview, statically imported. **Never import this module statically**: it is
 * reached only through {@link ./docx-loader.ts | `docx-loader`}'s dynamic import, so the engine and
 * JSZip stay out of every island's module graph and out of Fresh's server snapshot.
 *
 * A document is parsed once and may be drawn many times (toggling headers, notes or tracked
 * changes re-renders the same parse). Every parse is hardened before it is drawn, and every draw is
 * vetted after: docx-preview writes `w:sym` characters through `innerHTML`, puts document-supplied
 * hyperlink targets straight into `href`, and loads `altChunk` HTML into a `srcdoc` iframe — the
 * last is switched off, the first two are neutralised here.
 */
import { parseAsync, renderDocument } from "docx-preview";
import {
	type DocxFeatures,
	docxFeatures,
	type DocxProperties,
	docxProperties,
	docxRenderRoots,
	safeDocxHref,
	scrubDocxTree,
} from "../components/viewers/document/docx-model.ts";

// #region Contract
/** The render switches the Word canvas exposes. */
export interface DocxRenderSwitches {
	breakPages: boolean;
	headersFooters: boolean;
	notes: boolean;
	changes: boolean;
}

/** A parsed document, ready to be drawn into a container any number of times. */
export interface ParsedDocx {
	readonly properties: DocxProperties;
	/** The optional layers the document has, so the canvas offers only switches that change something. */
	readonly features: DocxFeatures;
	/** Draw (or redraw) the document; resolves once images and fonts have settled. */
	render(body: HTMLElement, styles: HTMLElement, switches: DocxRenderSwitches): Promise<void>;
}
// #endregion

const PARSE_OPTIONS = {
	className: "docx",
	inWrapper: true,
	ignoreWidth: false,
	ignoreHeight: false,
	ignoreFonts: false,
	trimXmlDeclaration: true,
	useBase64URL: true,
	experimental: false,
	debug: false,
} as const;

function harden(body: HTMLElement): void {
	for (const frame of Array.from(body.querySelectorAll("iframe, script, object, embed"))) {
		frame.remove();
	}
	for (const anchor of Array.from(body.querySelectorAll("a"))) {
		const link = safeDocxHref(anchor.getAttribute("href"));
		if (!link) {
			anchor.removeAttribute("href");
			continue;
		}
		anchor.setAttribute("href", link.href);
		if (link.external) {
			anchor.target = "_blank";
			anchor.rel = "noopener noreferrer";
		}
	}
}

/** Parse a .docx file. Rejects when the bytes are not a readable Word document. */
export async function parseDocx(data: Blob): Promise<ParsedDocx> {
	const doc: unknown = await parseAsync(data, PARSE_OPTIONS);
	scrubDocxTree(docxRenderRoots(doc));
	return {
		properties: docxProperties(doc),
		features: docxFeatures(doc),
		async render(body, styles, switches) {
			await renderDocument(doc, body, styles, {
				...PARSE_OPTIONS,
				breakPages: switches.breakPages,
				ignoreLastRenderedPageBreak: true,
				renderHeaders: switches.headersFooters,
				renderFooters: switches.headersFooters,
				renderFootnotes: switches.notes,
				renderEndnotes: switches.notes,
				renderChanges: switches.changes,
				renderComments: false,
				renderAltChunks: false,
				hideWrapperOnPrint: false,
			});
			harden(body);
		},
	};
}
