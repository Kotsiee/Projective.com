/**
 * content.anchors — heading ids and the table of contents, derived ONCE from a document.
 *
 * The rendered headings and the table of contents must agree on every id, so neither computes its
 * own: {@link anchorDoc} resolves the whole document's anchors in one pass and both the renderer
 * (`DocumentBody`) and {@link docToc} read the result.
 *
 * Stability rules, in order:
 *  1. An explicit id (every section's `id`, an `h3`'s optional `id`) is claimed first and is never
 *     changed — it is a public address someone may have shared.
 *  2. An `h3` without an id is slugified from its text and claimed in document order; a repeat is
 *     suffixed `-2`, `-3`, … so two "Example" sub-headings get `example` and `example-2`.
 *  3. Ids the layout itself renders ({@link RESERVED_ANCHOR_IDS}) are never handed out.
 *
 * Pure: no DOM, no zod, so the server renderer, the island and a unit test all share it.
 *
 * @module
 */
import type { Doc, DocSection } from "./doc.ts";
import type { ContentNode, HeadingNode } from "./nodes.ts";

// #region Ids
/**
 * Element ids the editorial layout renders itself (the shell's main landmark, the document title,
 * the table of contents). A document anchor may never take one — `checkDocAnchors` refuses an
 * explicit one and {@link anchorDoc} skips them when generating.
 */
export const RESERVED_ANCHOR_IDS: readonly string[] = [
	"main-content",
	"doc-article",
	"doc-title",
	"doc-summary",
	"doc-toc",
	"doc-toc-list",
	"doc-toc-sheet",
	"doc-meta",
	"doc-progress",
];

/**
 * A heading's text as a URL-safe anchor: accents folded (`Résumé` → `resume`), `&` read as "and",
 * every other run of non-alphanumerics collapsed to one hyphen, trimmed, capped at `maxLength`
 * characters on a word boundary where possible. Text with nothing usable becomes `section`.
 */
export function slugify(text: string, maxLength = 64): string {
	const folded = text
		.normalize("NFKD")
		.replace(/\p{M}+/gu, "")
		.toLowerCase()
		.replace(/&/g, " and ")
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");
	if (folded.length <= maxLength) return folded || "section";
	const cut = folded.slice(0, maxLength);
	const boundary = cut.lastIndexOf("-");
	return (boundary > maxLength / 2 ? cut.slice(0, boundary) : cut).replace(/-+$/, "") || "section";
}

/** Hands out unique ids: the first claim of a base gets it, later claims get `-2`, `-3`, … */
export interface AnchorRegistry {
	/** Claim `base`, or the first free `base-N`. Returns the id actually claimed. */
	claim(base: string): string;
	/** Whether `id` is already taken. */
	has(id: string): boolean;
}

/** Create an {@link AnchorRegistry}, pre-seeded with ids that are already in use. */
export function createAnchorRegistry(
	taken: Iterable<string> = RESERVED_ANCHOR_IDS,
): AnchorRegistry {
	const used = new Set(taken);
	return {
		claim(base) {
			let id = base;
			for (let n = 2; used.has(id); n++) id = `${base}-${n}`;
			used.add(id);
			return id;
		},
		has: (id) => used.has(id),
	};
}
// #endregion

// #region Anchored document
/** An `h3` whose anchor (and, when numbered, clause number) has been resolved. */
export interface AnchoredHeadingNode extends HeadingNode {
	id: string;
	/** `2.1` — present only when the document is numbered. */
	number?: string;
}

/** A body node after anchoring: every `h3` carries its id. */
export type AnchoredNode = Exclude<ContentNode, HeadingNode> | AnchoredHeadingNode;

/** A section after anchoring. */
export interface AnchoredSection extends Omit<DocSection, "body"> {
	/** The section's `h2` id (its explicit `id`). */
	anchor: string;
	/** `2` — present only when the document is numbered. */
	number?: string;
	body: AnchoredNode[];
}

/** A document whose every heading id is resolved — the one input of the renderer and the TOC. */
export interface AnchoredDoc<D extends Doc = Doc> {
	doc: D;
	sections: AnchoredSection[];
	/** Whether sections and sub-headings carry clause numbers (`1`, `1.1`). */
	numbered: boolean;
}

/** Options for {@link anchorDoc}. */
export interface AnchorDocOptions {
	/** Number sections `1, 2, …` and their `h3`s `1.1, 1.2, …` (legal clause numbers). */
	numbered?: boolean;
	/** Extra ids already used on the page, never handed to a generated anchor. */
	reserved?: Iterable<string>;
}

/**
 * Resolve every anchor in `doc` (rules in the module header). Deterministic: the same document
 * always yields the same ids, on the server and in the browser.
 */
export function anchorDoc<D extends Doc>(doc: D, options: AnchorDocOptions = {}): AnchoredDoc<D> {
	const numbered = options.numbered === true;
	const registry = createAnchorRegistry([...RESERVED_ANCHOR_IDS, ...(options.reserved ?? [])]);

	// Pass 1 — explicit ids, in document order, so a generated id can never take one.
	const explicit = new Map<string, string>();
	doc.sections.forEach((section, i) => {
		explicit.set(`s${i}`, registry.claim(section.id));
		section.body.forEach((node, j) => {
			if (node.type === "h3" && node.id) explicit.set(`s${i}n${j}`, registry.claim(node.id));
		});
	});

	// Pass 2 — generated ids for sub-headings without one, plus clause numbers.
	const sections = doc.sections.map((section, i): AnchoredSection => {
		let sub = 0;
		const body = section.body.map((node, j): AnchoredNode => {
			if (node.type !== "h3") return node;
			sub += 1;
			const id = explicit.get(`s${i}n${j}`) ?? registry.claim(slugify(node.text));
			return numbered ? { ...node, id, number: `${i + 1}.${sub}` } : { ...node, id };
		});
		const anchor = explicit.get(`s${i}`) as string;
		const { body: _body, ...rest } = section;
		return numbered ? { ...rest, anchor, number: String(i + 1), body } : { ...rest, anchor, body };
	});

	return { doc, sections, numbered };
}
// #endregion

// #region Table of contents
/** One table-of-contents entry: a section (`level` 2) with its sub-headings (`level` 3). */
export interface TocEntry {
	id: string;
	text: string;
	level: 2 | 3;
	/** Clause number when the document is numbered. */
	number?: string;
	children: TocEntry[];
}

/** Options for {@link docToc}. */
export interface DocTocOptions {
	/** `2` lists sections only; `3` (default) nests their sub-headings. */
	depth?: 2 | 3;
}

/** The table-of-contents tree of an anchored document. */
export function docToc(anchored: AnchoredDoc, options: DocTocOptions = {}): TocEntry[] {
	const depth = options.depth ?? 3;
	return anchored.sections.map((section) => ({
		id: section.anchor,
		text: section.heading,
		level: 2,
		...(section.number ? { number: section.number } : {}),
		children: depth < 3 ? [] : section.body.flatMap((node): TocEntry[] =>
			node.type === "h3"
				? [{
					id: node.id,
					text: node.text,
					level: 3,
					...(node.number ? { number: node.number } : {}),
					children: [],
				}]
				: []
		),
	}));
}

/** Every entry of a TOC tree in document order (the order the scroll-spy walks). */
export function flattenToc(entries: readonly TocEntry[]): TocEntry[] {
	return entries.flatMap((entry) => [entry, ...flattenToc(entry.children)]);
}
// #endregion
