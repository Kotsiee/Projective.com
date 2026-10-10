/**
 * docx-model — the pure half of the Word canvas: the zoom ladder, the hardening applied to a parsed
 * document before docx-preview draws it, link vetting, and the document properties shown as facts.
 * No DOM, so it is unit-tested.
 */

// #region Zoom
/** Smallest page zoom. */
export const DOCX_ZOOM_MIN = 0.25;
/** Largest page zoom. */
export const DOCX_ZOOM_MAX = 4;

const ZOOM_LADDER = [0.25, 0.33, 0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4];
const EPSILON = 0.005;

/** How the page zoom follows the stage: fit the width, never above 100%, or a chosen value. */
export type DocxZoomMode = "auto" | "fit" | "manual";

/** Clamp a zoom into the supported range; non-finite input becomes 100%. */
export function clampDocxZoom(zoom: number): number {
	if (!Number.isFinite(zoom) || zoom <= 0) return 1;
	return Math.min(DOCX_ZOOM_MAX, Math.max(DOCX_ZOOM_MIN, zoom));
}

/** The next ladder step above (`1`) or below (`-1`) the current zoom. */
export function stepDocxZoom(zoom: number, direction: 1 | -1): number {
	const current = clampDocxZoom(zoom);
	if (direction > 0) return ZOOM_LADDER.find((z) => z > current + EPSILON) ?? DOCX_ZOOM_MAX;
	return [...ZOOM_LADDER].reverse().find((z) => z < current - EPSILON) ?? DOCX_ZOOM_MIN;
}

/** The zoom that fits the widest page into the available width (`auto` never enlarges). */
export function fitDocxZoom(available: number, pageWidth: number, mode: "auto" | "fit"): number {
	if (!(available > 0) || !(pageWidth > 0)) return 1;
	const fit = clampDocxZoom(available / pageWidth);
	return mode === "auto" ? Math.min(1, fit) : fit;
}

/** `"125%"`. */
export function formatDocxZoom(zoom: number): string {
	return `${Math.round(zoom * 100)}%`;
}
// #endregion

// #region Hardening
type Node = Record<string, unknown>;

function isNode(value: unknown): value is Node {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

const SYMBOL_CHAR = /^[0-9a-f]{1,6}$/i;
const REPLACEMENT_CHAR = "fffd";

function walkNodes(roots: readonly unknown[], visit: (node: Node) => void): void {
	const seen = new Set<Node>();
	const stack: unknown[] = [...roots];
	while (stack.length > 0) {
		const next = stack.pop();
		if (Array.isArray(next)) {
			stack.push(...next);
			continue;
		}
		if (!isNode(next) || seen.has(next)) continue;
		seen.add(next);
		visit(next);
		if (Array.isArray(next.children)) stack.push(next.children);
	}
}

/**
 * Neutralise the parsed nodes docx-preview would otherwise write as markup: a `w:sym` character is
 * interpolated into `innerHTML` as `&#x<char>;`, so anything but a hex code point is replaced.
 * Returns how many nodes were rewritten.
 */
export function scrubDocxTree(roots: readonly unknown[]): number {
	let rewritten = 0;
	walkNodes(roots, (node) => {
		if (node.type !== "symbol") return;
		const char = node.char;
		const valid = typeof char === "string" && SYMBOL_CHAR.test(char) &&
			Number.parseInt(char, 16) <= 0x10ffff;
		if (!valid) {
			node.char = REPLACEMENT_CHAR;
			rewritten += 1;
		}
	});
	return rewritten;
}

/** The parsed trees of a docx-preview document that are ever rendered: body, headers, footers, notes. */
export function docxRenderRoots(doc: unknown): unknown[] {
	if (!isNode(doc)) return [];
	const roots: unknown[] = [];
	const documentPart = doc.documentPart;
	if (isNode(documentPart)) roots.push(documentPart.body);
	if (Array.isArray(doc.parts)) {
		for (const part of doc.parts) {
			if (!isNode(part)) continue;
			if (part.rootElement !== undefined) roots.push(part.rootElement);
			if (Array.isArray(part.notes)) roots.push(part.notes);
		}
	}
	return roots;
}

/** Which optional layers the document actually has, so the canvas offers only live switches. */
export interface DocxFeatures {
	headersFooters: boolean;
	notes: boolean;
	changes: boolean;
}

const NOTE_REFERENCES = new Set(["footnoteReference", "endnoteReference"]);
const CHANGES = new Set(["inserted", "deleted", "deletedText"]);

/** Detect headers/footers with content, note references in the body, and tracked changes. */
export function docxFeatures(doc: unknown): DocxFeatures {
	const features: DocxFeatures = { headersFooters: false, notes: false, changes: false };
	if (!isNode(doc)) return features;
	const bands: unknown[] = [];
	if (Array.isArray(doc.parts)) {
		for (const part of doc.parts) {
			const root = isNode(part) ? part.rootElement : null;
			if (!isNode(root) || (root.type !== "header" && root.type !== "footer")) continue;
			bands.push(root);
			if (Array.isArray(root.children) && root.children.length > 0) features.headersFooters = true;
		}
	}
	const body = isNode(doc.documentPart) ? doc.documentPart.body : null;
	walkNodes([body, ...bands], (node) => {
		const type = typeof node.type === "string" ? node.type : "";
		if (NOTE_REFERENCES.has(type)) features.notes = true;
		if (CHANGES.has(type)) features.changes = true;
	});
	return features;
}

/** A vetted hyperlink target. */
export interface DocxLink {
	href: string;
	/** Opens in a new tab with no opener or referrer. */
	external: boolean;
}

const SAFE_PROTOCOLS = new Set(["http:", "https:", "mailto:"]);

/** Vet a link target written by the document: in-document anchors and http(s)/mailto only. */
export function safeDocxHref(raw: string | null): DocxLink | null {
	const href = raw?.trim() ?? "";
	if (href.length === 0) return null;
	if (href.startsWith("#")) return href.length > 1 ? { href, external: false } : null;
	if (!URL.canParse(href)) return null;
	const url = new URL(href);
	return SAFE_PROTOCOLS.has(url.protocol) ? { href: url.href, external: true } : null;
}
// #endregion

// #region Properties
/** What the document says about itself in its core and extended properties. */
export interface DocxProperties {
	title: string | null;
	author: string | null;
	application: string | null;
	pages: number | null;
	words: number | null;
}

/** One labelled fact, shaped like the inspector shell's stage facts. */
export interface DocxFact {
	label: string;
	value: string;
}

function text(value: unknown): string | null {
	return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function count(value: unknown): number | null {
	return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : null;
}

/** Read the core/extended properties docx-preview parsed, tolerating any missing part. */
export function docxProperties(doc: unknown): DocxProperties {
	const core = isNode(doc) && isNode(doc.corePropsPart) ? doc.corePropsPart.props : null;
	const extended = isNode(doc) && isNode(doc.extendedPropsPart)
		? doc.extendedPropsPart.props
		: null;
	const c = isNode(core) ? core : {};
	const e = isNode(extended) ? extended : {};
	return {
		title: text(c.title),
		author: text(c.creator),
		application: text(e.application),
		pages: count(e.pages),
		words: count(e.words),
	};
}

/** The facts the Details panel lists; `Pages` is left out when the asset already states it. */
export function docxFacts(props: DocxProperties, assetPageCount: number | null): DocxFact[] {
	const facts: DocxFact[] = [];
	if (props.title) facts.push({ label: "Title", value: props.title });
	if (props.author) facts.push({ label: "Author", value: props.author });
	if (props.pages !== null && assetPageCount === null) {
		facts.push({ label: "Pages", value: props.pages.toLocaleString("en-GB") });
	}
	if (props.words !== null) {
		facts.push({ label: "Words", value: props.words.toLocaleString("en-GB") });
	}
	if (props.application) facts.push({ label: "Created with", value: props.application });
	return facts;
}
// #endregion
