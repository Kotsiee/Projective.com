/**
 * legal-pdf — one legal document version laid out as the blocks of a text-only PDF (Decision #270).
 *
 * The shared writer (`core/pdf.ts`) draws rows, rules and space and leaves line breaking to its
 * caller, because a financial document never wraps. A legal document is nothing but wrapped prose, so
 * this module breaks every paragraph into lines that fit the page, hangs list markers and clause
 * numbers, and keeps the draft disclosure (owner ruling (e)) at the head and the foot of the file.
 *
 * Widths are estimated from Helvetica's advance widths by character class, rounded UP, so a line can
 * come out a little shorter than the page allows but never runs past the margin.
 *
 * Pure: a document in, blocks out, so it is unit-tested without rendering a byte.
 *
 * @module
 */
import {
	anchorDoc,
	type AnchoredNode,
	type ContentNode,
	formatContentDate,
	inlineText,
	type LegalDoc,
	type ListNode,
	nodeText,
} from "@projective/types/content";
import type { PdfBlock, PdfLine } from "../../core/pdf.ts";

// #region Measure
/** The printable width of the shared writer's A4 page (595.28pt less two 56pt margins). */
export const PDF_TEXT_WIDTH = 483;

/** An upper bound on a character's Helvetica advance, in em. */
function charEm(ch: string): number {
	if (ch === " ") return 0.278;
	if ("iljI.,;:!'’|".includes(ch)) return 0.28;
	if ('ftr()[]{}-/"“”‘'.includes(ch)) return 0.39;
	if ("mwMW@%—".includes(ch)) return 1;
	if (/[A-Z]/.test(ch)) return 0.78;
	return 0.56;
}

/** The estimated width of `text` at `size` points (bold set ~6% wider). */
export function measure(text: string, size: number, bold = false): number {
	let em = 0;
	for (const ch of text) em += charEm(ch);
	return em * size * (bold ? 1.06 : 1);
}

/**
 * Break `text` into lines no wider than `width` points at `size`, on spaces; a single word longer
 * than the line is cut where it must be. An empty text is one empty line.
 */
export function wrapText(text: string, size: number, width: number, bold = false): string[] {
	const words = text.replace(/\s+/g, " ").trim().split(" ");
	const lines: string[] = [];
	let line = "";
	for (const word of words) {
		const candidate = line ? `${line} ${word}` : word;
		if (measure(candidate, size, bold) <= width) {
			line = candidate;
			continue;
		}
		if (line) lines.push(line);
		let rest = word;
		while (measure(rest, size, bold) > width && rest.length > 1) {
			let cut = rest.length - 1;
			while (cut > 1 && measure(rest.slice(0, cut), size, bold) > width) cut--;
			lines.push(rest.slice(0, cut));
			rest = rest.slice(cut);
		}
		line = rest;
	}
	lines.push(line);
	return lines;
}

/** WinAnsi, the standard fonts' encoding: printable ASCII, Latin-1 and these typographic marks. */
const WIN_ANSI_EXTRA = new Set(["€", "—", "–", "•", "’", "‘", "“", "”", "…"]);

/** Whether every character of `text` survives the writer's WinAnsi encoding (none becomes `?`). */
export function isPdfEncodable(text: string): boolean {
	for (const ch of text) {
		const code = ch.codePointAt(0) ?? 0;
		const ok = (code >= 32 && code <= 126) || (code >= 160 && code <= 255) ||
			WIN_ANSI_EXTRA.has(ch);
		if (!ok) return false;
	}
	return true;
}

/** Spellings for the marks the web copy uses that WinAnsi has no glyph for (`Settings → Account`). */
const PDF_SPELLINGS: ReadonlyArray<[RegExp, string]> = [
	[/→/g, "->"],
	[/←/g, "<-"],
	[/≥/g, ">="],
	[/≤/g, "<="],
];

/** `text` with every mark WinAnsi cannot encode spelled in characters it can. */
export function pdfSafe(text: string): string {
	return PDF_SPELLINGS.reduce((out, [mark, spelling]) => out.replace(mark, spelling), text);
}
// #endregion

// #region Blocks
const BODY = 10.5;
const SMALL = 9;
/** The indent of a list level, and of the text after a hanging marker, in points. */
const INDENT = 16;

/** Wrapped prose as rows, every line at `x`. */
function paragraph(
	text: string,
	opts: { size?: number; bold?: boolean; x?: number } = {},
): PdfBlock[] {
	const size = opts.size ?? BODY;
	const x = opts.x ?? 0;
	return wrapText(pdfSafe(text), size, PDF_TEXT_WIDTH - x, opts.bold).map((line): PdfBlock => ({
		kind: "row",
		left: { text: line, size, bold: opts.bold, x },
	}));
}

/**
 * A list item: the marker opens the first line at `x`, and the lines after it hang at `x + INDENT`,
 * under the text rather than under the marker.
 */
function hanging(marker: string, text: string, x: number, size = BODY): PdfBlock[] {
	const lines = wrapText(pdfSafe(text), size, PDF_TEXT_WIDTH - x - INDENT);
	return lines.map((line, i): PdfBlock => {
		const left: PdfLine = i === 0
			? { text: `${marker} ${line}`, size, x }
			: { text: line, size, x: x + INDENT };
		return { kind: "row", left };
	});
}

/** The marker of item `i` of a list. */
function marker(list: ListNode, i: number, depth: number): string {
	if (!list.ordered) return depth === 0 ? "•" : "–";
	const kind = list.marker ?? (depth === 0 ? "decimal" : "lower-alpha");
	if (kind === "lower-alpha") return `(${String.fromCharCode(97 + (i % 26))})`;
	if (kind === "lower-roman") {
		const romans = ["i", "ii", "iii", "iv", "v", "vi", "vii", "viii", "ix", "x", "xi", "xii"];
		return `(${romans[i] ?? String(i + 1)})`;
	}
	return `${i + 1}.`;
}

/** A list, nested lists one indent deeper. */
function list(node: ListNode, depth = 0): PdfBlock[] {
	return node.items.flatMap((item, i) => {
		const text = typeof item === "string" ? item : inlineText(item.content);
		const own = hanging(marker(node, i, depth), text, depth * INDENT);
		const nested = typeof item !== "string" && item.list ? list(item.list, depth + 1) : [];
		return [...own, ...nested];
	});
}

/** One body node. */
function node(n: AnchoredNode | ContentNode): PdfBlock[] {
	switch (n.type) {
		case "p":
			return paragraph(inlineText(n.content));
		case "h3": {
			const number = "number" in n && n.number ? `${n.number} ` : "";
			return [
				{ kind: "space", points: 4 },
				...paragraph(`${number}${n.text}`, { size: 11, bold: true }),
			];
		}
		case "list":
			return list(n);
		case "quote":
			return paragraph(nodeText(n), { x: INDENT });
		case "code":
			return n.text.split("\n").flatMap((line) =>
				paragraph(line || " ", { size: SMALL, x: INDENT })
			);
		case "image":
			return paragraph(`[Figure: ${n.caption ?? n.alt}]`, { size: SMALL });
		case "callout":
			return [
				...paragraph((n.title ?? n.tone).toUpperCase(), { size: SMALL, bold: true }),
				...n.body.flatMap((
					b,
				) => (b.type === "p" ? paragraph(inlineText(b.content), { x: INDENT }) : list(b, 1))),
			];
		case "table":
			return [
				...(n.caption ? paragraph(n.caption, { size: SMALL, bold: true }) : []),
				...n.rows.flatMap((row) => {
					const [first, ...rest] = row.map(inlineText);
					const labels = n.head.map(inlineText);
					return [
						{ kind: "space", points: 2 } as PdfBlock,
						...paragraph(`${labels[0]}: ${first}`, { bold: n.rowHeaders === true }),
						...rest.flatMap((cell, i) => paragraph(`${labels[i + 1]}: ${cell}`, { x: INDENT })),
					];
				}),
			];
		case "dl":
			return n.items.flatMap((item) => [
				...paragraph(item.term, { bold: true }),
				...paragraph(inlineText(item.definition), { x: INDENT }),
			]);
	}
}

/** The disclosure every unreviewed version carries, at the head and the foot of the file. */
export const DRAFT_PDF_LINE = "DRAFT — PENDING LEGAL REVIEW";

/** What {@link legalPdfDocument} needs beyond the document. */
export interface LegalPdfOptions {
	/** Whether this version is the one in effect today. */
	current: boolean;
	/** The document's canonical URL, printed in the foot. */
	canonical: string;
}

/**
 * Lay a legal document version out for the PDF writer: the brand line (and the draft mark), the
 * title, the version and its dates, the draft disclosure, the summary, then every clause — its number
 * and heading, its plain-English summary, its body — and the foot.
 */
export function legalPdfBlocks(doc: LegalDoc, opts: LegalPdfOptions): PdfBlock[] {
	const draft = doc.reviewedAt === null;
	const anchored = anchorDoc(doc, { numbered: true });
	const facts = [
		`Version ${doc.version}`,
		`Effective ${formatContentDate(doc.effectiveDate)}`,
		`Updated ${formatContentDate(doc.updatedAt)}`,
		...(doc.reviewedAt ? [`Reviewed ${formatContentDate(doc.reviewedAt)}`] : []),
	].join(" · ");

	const blocks: PdfBlock[] = [
		{
			kind: "row",
			left: { text: "Projective · Legal", size: SMALL, bold: true },
			...(draft ? { right: { text: DRAFT_PDF_LINE, size: SMALL, bold: true } } : {}),
		},
		{ kind: "space", points: 12 },
		...paragraph(doc.title, { size: 20, bold: true }),
		{ kind: "space", points: 2 },
		...paragraph(facts, { size: SMALL }),
	];
	if (draft) {
		blocks.push(
			{ kind: "space", points: 8 },
			...paragraph(
				"Draft — pending legal review. This text describes how Projective works today and has not yet been reviewed by a lawyer. Its wording may change before it is.",
				{ size: SMALL, bold: true },
			),
		);
	}
	if (!opts.current) {
		blocks.push(
			{ kind: "space", points: 6 },
			...paragraph(
				`This is not the version in effect today. Read the current version at ${opts.canonical}`,
				{
					size: SMALL,
				},
			),
		);
	}
	blocks.push({ kind: "space", points: 10 }, ...paragraph(doc.summary, { size: 11 }), {
		kind: "rule",
	});

	for (const section of anchored.sections) {
		blocks.push(
			{ kind: "space", points: 10 },
			...paragraph(`${section.number}. ${section.heading}`, { size: 13, bold: true }),
		);
		if (section.tldr) {
			blocks.push(
				{ kind: "space", points: 2 },
				...paragraph("PLAIN-ENGLISH SUMMARY", { size: 7.5, bold: true }),
				...paragraph(inlineText(section.tldr), { size: 10 }),
				{ kind: "space", points: 4 },
			);
		}
		for (const n of section.body) blocks.push(...node(n), { kind: "space", points: 3 });
	}

	blocks.push(
		{ kind: "space", points: 8 },
		{ kind: "rule" },
		...paragraph(`${doc.title} · Version ${doc.version} · ${opts.canonical}`, { size: 8 }),
		...(draft ? paragraph(DRAFT_PDF_LINE, { size: 8, bold: true }) : []),
	);
	return blocks;
}

/** Every line of text in `blocks`, in order — what a test reads instead of the PDF bytes. */
export function blockText(blocks: readonly PdfBlock[]): string[] {
	return blocks.flatMap((b) =>
		b.kind === "row" ? [b.left.text, ...(b.right ? [b.right.text] : [])] : []
	);
}
// #endregion
