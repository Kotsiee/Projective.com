import type { StageFact } from "../../../core/inspector-shell.ts";

/**
 * pdf-facts — a PDF's document properties phrased for the Details panel: its info dictionary
 * (title, author, producer…), its PDF version, the first page's paper size and its dates.
 */

// #region Info
/** The info-dictionary fields the panel shows, already trimmed; absent fields are `null`. */
export interface PdfInfo {
	title: string | null;
	author: string | null;
	subject: string | null;
	creator: string | null;
	producer: string | null;
	version: string | null;
	created: Date | null;
	modified: Date | null;
}

const MAX_FIELD = 300;

function field(record: Record<string, unknown>, key: string): string | null {
	const value = record[key];
	if (typeof value !== "string") return null;
	const text = value.replace(/\s+/g, " ").trim();
	if (text.length === 0) return null;
	return text.length > MAX_FIELD ? `${text.slice(0, MAX_FIELD - 1)}…` : text;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

/** Read the fields the panel shows from pdf.js's untyped info dictionary. */
export function readPdfInfo(info: unknown): PdfInfo {
	const record = isRecord(info) ? info : {};
	const created = field(record, "CreationDate");
	const modified = field(record, "ModDate");
	return {
		title: field(record, "Title"),
		author: field(record, "Author"),
		subject: field(record, "Subject"),
		creator: field(record, "Creator"),
		producer: field(record, "Producer"),
		version: field(record, "PDFFormatVersion"),
		created: created ? parsePdfDate(created) : null,
		modified: modified ? parsePdfDate(modified) : null,
	};
}

const PDF_DATE =
	/^(?:D:)?(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?(\d{2})?\s*(?:([Zz])|([+-])(\d{2})'?(\d{2})?'?)?/;

/** Parse a PDF date string (`D:YYYYMMDDHHmmSSOHH'mm'`, everything after the year optional). */
export function parsePdfDate(raw: string): Date | null {
	const m = PDF_DATE.exec(raw.trim());
	if (!m) return null;
	const num = (part: string | undefined, fallback: number) => (part ? Number(part) : fallback);
	const year = num(m[1], 0);
	const month = num(m[2], 1);
	const day = num(m[3], 1);
	const hour = num(m[4], 0);
	const minute = num(m[5], 0);
	const second = num(m[6], 0);
	if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59 || second > 59) {
		return null;
	}
	let offset = 0;
	if (m[8]) {
		const sign = m[8] === "-" ? -1 : 1;
		offset = sign * (num(m[9], 0) * 60 + num(m[10], 0));
	}
	const utc = Date.UTC(year, month - 1, day, hour, minute, second) - offset * 60_000;
	const date = new Date(utc);
	return Number.isNaN(date.getTime()) ? null : date;
}
// #endregion

// #region Paper
interface Paper {
	name: string;
	width: number;
	height: number;
	unit: "mm" | "in";
}

const PAPERS: readonly Paper[] = [
	{ name: "A3", width: 842, height: 1191, unit: "mm" },
	{ name: "A4", width: 595, height: 842, unit: "mm" },
	{ name: "A5", width: 420, height: 595, unit: "mm" },
	{ name: "Letter", width: 612, height: 792, unit: "in" },
	{ name: "Legal", width: 612, height: 1008, unit: "in" },
	{ name: "Tabloid", width: 792, height: 1224, unit: "in" },
];

const PAPER_TOLERANCE = 3;

function near(a: number, b: number): boolean {
	return Math.abs(a - b) <= PAPER_TOLERANCE;
}

function trimNumber(value: number, digits: number): string {
	return Number(value.toFixed(digits)).toString();
}

/**
 * A page size in points as a reader says it: `"A4 · 210 × 297 mm"`, `"Letter landscape · 11 × 8.5
 * in"`, or plain millimetres for anything else.
 */
export function pageSizeLabel(width: number, height: number): string {
	const mm = (pt: number) => trimNumber((pt * 25.4) / 72, 0);
	const inch = (pt: number) => trimNumber(pt / 72, 2);
	for (const paper of PAPERS) {
		const upright = near(width, paper.width) && near(height, paper.height);
		const sideways = near(width, paper.height) && near(height, paper.width);
		if (!upright && !sideways) continue;
		const name = sideways ? `${paper.name} landscape` : paper.name;
		const dims = paper.unit === "in"
			? `${inch(width)} × ${inch(height)} in`
			: `${mm(width)} × ${mm(height)} mm`;
		return `${name} · ${dims}`;
	}
	return `${mm(width)} × ${mm(height)} mm`;
}
// #endregion

// #region Facts
/** What {@link documentFacts} phrases. */
export interface DocumentFactsInput {
	info: PdfInfo;
	pageCount: number;
	/** The page count the server already shows in Details, if it knows one. */
	knownPageCount: number | null;
	/** The first page's size in points, as drawn upright. */
	firstPage: { width: number; height: number } | null;
	formatDate: (date: Date) => string;
}

/** The document's properties as Details rows, in reading order, omitting anything unknown. */
export function documentFacts(input: DocumentFactsInput): StageFact[] {
	const { info, pageCount, knownPageCount, firstPage, formatDate } = input;
	const facts: StageFact[] = [];
	const push = (label: string, value: string | null) => {
		if (value !== null && value.length > 0) facts.push({ label, value });
	};
	push("Title", info.title);
	push("Author", info.author);
	push("Subject", info.subject);
	if (knownPageCount === null && pageCount > 0) push("Pages", String(pageCount));
	push("Page size", firstPage ? pageSizeLabel(firstPage.width, firstPage.height) : null);
	push("PDF version", info.version);
	push("Created with", info.creator);
	push("Produced by", info.producer);
	push("Created", info.created ? formatDate(info.created) : null);
	push("Modified", info.modified ? formatDate(info.modified) : null);
	return facts;
}
// #endregion
